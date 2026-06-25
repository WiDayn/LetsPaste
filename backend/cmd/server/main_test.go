package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

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
