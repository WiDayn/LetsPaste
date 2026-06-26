package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"
)

func newTestApp(t *testing.T) *app {
	t.Helper()

	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() {
		if err := db.Close(); err != nil {
			t.Fatalf("close database: %v", err)
		}
	})

	a := &app{db: db, jwtSecret: []byte("test-secret")}
	if err := a.migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return a
}

func insertTestUser(t *testing.T, a *app, username, secret, role string) *user {
	t.Helper()

	hash, err := bcrypt.GenerateFromPassword([]byte(secret), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("hash secret: %v", err)
	}
	res, err := a.db.Exec(`INSERT INTO users(username, password_hash, role) VALUES(?, ?, ?)`, username, string(hash), role)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatalf("last insert id: %v", err)
	}
	u, err := a.findUserByID(id)
	if err != nil {
		t.Fatalf("find user: %v", err)
	}
	return u
}

func TestUpdateMySecretAllowsShortSecrets(t *testing.T) {
	cases := []struct {
		name      string
		username  string
		role      string
		oldSecret string
		newSecret string
	}{
		{name: "user mnemonic", username: "user-short-secret", role: "user", oldSecret: "old-user-secret", newSecret: "abc"},
		{name: "admin password", username: "admin-short-secret", role: "admin", oldSecret: "old-admin-secret", newSecret: "x"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a := newTestApp(t)
			u := insertTestUser(t, a, tc.username, tc.oldSecret, tc.role)

			body, err := json.Marshal(map[string]string{
				"currentSecret": tc.oldSecret,
				"newSecret":     tc.newSecret,
			})
			if err != nil {
				t.Fatalf("marshal request: %v", err)
			}
			req := httptest.NewRequest(http.MethodPut, "/api/me/secret", bytes.NewReader(body))
			rec := httptest.NewRecorder()

			a.updateMySecret(rec, req.WithContext(withUser(req.Context(), u)))

			if rec.Code != http.StatusOK {
				t.Fatalf("expected status 200, got %d with body %s", rec.Code, rec.Body.String())
			}
			var payload struct {
				Mnemonic string `json:"mnemonic"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if payload.Mnemonic != tc.newSecret {
				t.Fatalf("expected returned secret %q, got %q", tc.newSecret, payload.Mnemonic)
			}

			updated, err := a.findUserByID(u.ID)
			if err != nil {
				t.Fatalf("find updated user: %v", err)
			}
			if err := bcrypt.CompareHashAndPassword([]byte(updated.PasswordHash), []byte(tc.newSecret)); err != nil {
				t.Fatalf("new short secret was not accepted: %v", err)
			}
			if err := bcrypt.CompareHashAndPassword([]byte(updated.PasswordHash), []byte(tc.oldSecret)); err == nil {
				t.Fatal("old secret still works after update")
			}
		})
	}
}

func TestGetPasteLockedIncludesSafeMetadata(t *testing.T) {
	a := newTestApp(t)
	hash, err := bcrypt.GenerateFromPassword([]byte("open-sesame"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	_, err = a.db.Exec(`INSERT INTO pastes(id, title, content, language, format, is_private, password_hash, burn_after_reading)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?)`, "protected-direct", "Protected direct link", "secret content", "markdown", "markdown", 0, string(hash), 1)
	if err != nil {
		t.Fatalf("insert paste: %v", err)
	}

	router := chi.NewRouter()
	router.Get("/api/pastes/{id}", a.getPaste)
	req := httptest.NewRequest(http.MethodGet, "/api/pastes/protected-direct", nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusLocked {
		t.Fatalf("expected status 423, got %d with body %s", rec.Code, rec.Body.String())
	}
	if bytes.Contains(rec.Body.Bytes(), []byte("secret content")) {
		t.Fatal("locked response leaked paste content")
	}
	var payload struct {
		RequiresPassword bool  `json:"requiresPassword"`
		Paste            paste `json:"paste"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.RequiresPassword {
		t.Fatal("expected requiresPassword to be true")
	}
	if payload.Paste.ID != "protected-direct" || payload.Paste.Title != "Protected direct link" {
		t.Fatalf("unexpected paste metadata: %+v", payload.Paste)
	}
	if payload.Paste.Content != "" {
		t.Fatal("locked metadata should not include content")
	}
	if !payload.Paste.HasPassword || !payload.Paste.BurnAfterReading {
		t.Fatalf("expected protected burn metadata, got hasPassword=%v burn=%v", payload.Paste.HasPassword, payload.Paste.BurnAfterReading)
	}
}

func TestAdminUsersIncludesPasteCount(t *testing.T) {
	a := newTestApp(t)
	owner := insertTestUser(t, a, "paste-owner", "owner-secret", "user")
	other := insertTestUser(t, a, "no-pastes", "other-secret", "user")
	_, err := a.db.Exec(`INSERT INTO pastes(id, title, content, language, format, is_private, owner_id)
		VALUES
		(?, ?, ?, ?, ?, ?, ?),
		(?, ?, ?, ?, ?, ?, ?)`,
		"owner-paste-1", "Owner Paste 1", "content", "plaintext", "code", 0, owner.ID,
		"owner-paste-2", "Owner Paste 2", "content", "markdown", "markdown", 0, owner.ID,
	)
	if err != nil {
		t.Fatalf("insert pastes: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/users", nil)
	rec := httptest.NewRecorder()

	a.adminUsers(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d with body %s", rec.Code, rec.Body.String())
	}
	var users []user
	if err := json.Unmarshal(rec.Body.Bytes(), &users); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	counts := map[int64]int{}
	for _, u := range users {
		counts[u.ID] = u.PasteCount
	}
	if counts[owner.ID] != 2 {
		t.Fatalf("expected owner paste count 2, got %d", counts[owner.ID])
	}
	if counts[other.ID] != 0 {
		t.Fatalf("expected other paste count 0, got %d", counts[other.ID])
	}
}

func TestAdminPastesOwnerFilterMatchesExactOwnerOnly(t *testing.T) {
	a := newTestApp(t)
	alice := insertTestUser(t, a, "alice", "alice-secret", "user")
	bob := insertTestUser(t, a, "bob", "bob-secret", "user")
	_, err := a.db.Exec(`INSERT INTO pastes(id, title, content, language, format, is_private, owner_id)
		VALUES
		(?, ?, ?, ?, ?, ?, ?),
		(?, ?, ?, ?, ?, ?, ?)`,
		"alice-paste", "bob appears in this title", "alice content", "plaintext", "code", 0, alice.ID,
		"bob-paste", "Owned by Bob", "bob content", "plaintext", "code", 0, bob.ID,
	)
	if err != nil {
		t.Fatalf("insert pastes: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/pastes?owner=bob", nil)
	rec := httptest.NewRecorder()

	a.adminPastes(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d with body %s", rec.Code, rec.Body.String())
	}
	var pastes []paste
	if err := json.Unmarshal(rec.Body.Bytes(), &pastes); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(pastes) != 1 {
		t.Fatalf("expected exactly one paste, got %d: %+v", len(pastes), pastes)
	}
	if pastes[0].ID != "bob-paste" {
		t.Fatalf("expected bob-paste, got %s", pastes[0].ID)
	}
	if pastes[0].OwnerUsername == nil || *pastes[0].OwnerUsername != "bob" {
		t.Fatalf("expected owner bob, got %+v", pastes[0].OwnerUsername)
	}
}

func TestAdminPastesOwnerFilterSupportsAnonymous(t *testing.T) {
	a := newTestApp(t)
	owner := insertTestUser(t, a, "owner", "owner-secret", "user")
	_, err := a.db.Exec(`INSERT INTO pastes(id, title, content, language, format, is_private, owner_id)
		VALUES
		(?, ?, ?, ?, ?, ?, NULL),
		(?, ?, ?, ?, ?, ?, ?)`,
		"anonymous-paste", "Anonymous Paste", "anonymous content", "plaintext", "code", 0,
		"owned-paste", "Owned Paste", "owned content", "plaintext", "code", 0, owner.ID,
	)
	if err != nil {
		t.Fatalf("insert pastes: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/pastes?owner=__anonymous", nil)
	rec := httptest.NewRecorder()

	a.adminPastes(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d with body %s", rec.Code, rec.Body.String())
	}
	var pastes []paste
	if err := json.Unmarshal(rec.Body.Bytes(), &pastes); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(pastes) != 1 {
		t.Fatalf("expected exactly one anonymous paste, got %d: %+v", len(pastes), pastes)
	}
	if pastes[0].ID != "anonymous-paste" {
		t.Fatalf("expected anonymous-paste, got %s", pastes[0].ID)
	}
	if pastes[0].OwnerUsername != nil {
		t.Fatalf("expected anonymous owner, got %+v", *pastes[0].OwnerUsername)
	}
}

func TestAdminPastesSecurityFilterSupportsActiveExpiring(t *testing.T) {
	a := newTestApp(t)
	activeExpiry := time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
	expired := time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
	_, err := a.db.Exec(`INSERT INTO pastes(id, title, content, language, format, is_private, expires_at)
		VALUES
		(?, ?, ?, ?, ?, ?, ?),
		(?, ?, ?, ?, ?, ?, ?),
		(?, ?, ?, ?, ?, ?, NULL)`,
		"active-expiring", "Active Expiring", "active", "plaintext", "code", 0, activeExpiry,
		"expired-paste", "Expired Paste", "expired", "plaintext", "code", 0, expired,
		"permanent-paste", "Permanent Paste", "permanent", "plaintext", "code", 0,
	)
	if err != nil {
		t.Fatalf("insert pastes: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/admin/pastes?security=expiring", nil)
	rec := httptest.NewRecorder()

	a.adminPastes(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d with body %s", rec.Code, rec.Body.String())
	}
	var pastes []paste
	if err := json.Unmarshal(rec.Body.Bytes(), &pastes); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(pastes) != 1 {
		t.Fatalf("expected exactly one active expiring paste, got %d: %+v", len(pastes), pastes)
	}
	if pastes[0].ID != "active-expiring" {
		t.Fatalf("expected active-expiring, got %s", pastes[0].ID)
	}
}
