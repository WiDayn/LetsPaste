package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

type app struct {
	db        *sql.DB
	jwtSecret []byte
}

type user struct {
	ID           int64  `json:"id"`
	Username     string `json:"username"`
	PasswordHash string `json:"-"`
	Role         string `json:"role"`
	CreatedAt    string `json:"createdAt"`
}

type paste struct {
	ID               string  `json:"id"`
	Title            string  `json:"title"`
	Content          string  `json:"content,omitempty"`
	Language         string  `json:"language"`
	Format           string  `json:"format"`
	IsPrivate        bool    `json:"isPrivate"`
	HasPassword      bool    `json:"hasPassword"`
	BurnAfterReading bool    `json:"burnAfterReading"`
	ExpiresAt        *string `json:"expiresAt"`
	Views            int     `json:"views"`
	OwnerID          *int64  `json:"ownerId"`
	OwnerUsername    *string `json:"ownerUsername"`
	CreatedAt        string  `json:"createdAt"`
}

type claims struct {
	UserID   int64  `json:"userId"`
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

func main() {
	dbPath := env("DB_PATH", "./data/letspaste.db")
	if dir := filepath.Dir(dbPath); dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			log.Fatal(err)
		}
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	a := &app{db: db, jwtSecret: []byte(env("JWT_SECRET", "change-me-in-production"))}
	if err := a.migrate(); err != nil {
		log.Fatal(err)
	}
	if err := a.ensureAdmin(); err != nil {
		log.Fatal(err)
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Logger, middleware.Recoverer)
	r.Use(cors)

	r.Get("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	r.Post("/api/auth/register", a.register)
	r.Post("/api/auth/login", a.login)
	r.Get("/api/settings", a.publicSettings)
	r.Get("/api/pastes/{id}", a.getPaste)
	r.Post("/api/pastes/{id}/unlock", a.unlockPaste)

	r.Group(func(r chi.Router) {
		r.Use(a.optionalAuth)
		r.Get("/api/pastes", a.listPastes)
		r.Post("/api/pastes", a.createPaste)
	})

	r.Group(func(r chi.Router) {
		r.Use(a.requireAuth)
		r.Get("/api/me", a.me)
		r.Put("/api/me/secret", a.updateMySecret)
		r.Get("/api/my/pastes", a.myPastes)
	})

	r.Group(func(r chi.Router) {
		r.Use(a.requireAdmin)
		r.Get("/api/admin/stats", a.adminStats)
		r.Get("/api/admin/users", a.adminUsers)
		r.Delete("/api/admin/users/{id}", a.adminDeleteUser)
		r.Put("/api/admin/users/{id}/role", a.adminUpdateUserRole)
		r.Get("/api/admin/pastes", a.adminPastes)
		r.Delete("/api/admin/pastes/{id}", a.deletePaste)
		r.Get("/api/admin/settings", a.adminSettings)
		r.Put("/api/admin/settings", a.updateSettings)
	})

	if staticDir := env("STATIC_DIR", "./public"); dirExists(staticDir) {
		serveSPA(r, staticDir)
	}

	addr := ":" + env("PORT", "8080")
	log.Printf("LetsPaste listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, r))
}

func (a *app) migrate() error {
	stmts := []string{
		`PRAGMA foreign_keys = ON;`,
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'user',
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS pastes (
			id TEXT PRIMARY KEY,
			title TEXT NOT NULL,
			content TEXT NOT NULL,
			language TEXT NOT NULL,
			format TEXT NOT NULL DEFAULT 'code',
			is_private INTEGER NOT NULL DEFAULT 0,
			password_hash TEXT,
			burn_after_reading INTEGER NOT NULL DEFAULT 0,
			expires_at DATETIME,
			views INTEGER NOT NULL DEFAULT 0,
			owner_id INTEGER,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE SET NULL
		);`,
		`INSERT OR IGNORE INTO settings(key, value) VALUES
			('allow_anonymous_paste', 'true'),
			('site_name', 'LetsPaste');`,
	}
	for _, stmt := range stmts {
		if _, err := a.db.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}

func (a *app) ensureAdmin() error {
	var count int
	if err := a.db.QueryRow(`SELECT COUNT(*) FROM users WHERE role = 'admin'`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	username := env("ADMIN_USERNAME", "admin")
	password := env("ADMIN_PASSWORD", "changeme123")
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = a.db.Exec(`INSERT INTO users(username, password_hash, role) VALUES(?, ?, 'admin')`, username, string(hash))
	return err
}

func (a *app) register(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Mnemonic string `json:"mnemonic"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	mnemonic := normalizeSecret(req.Mnemonic)
	if mnemonic == "" {
		mnemonic = generateMnemonic()
	}
	if mnemonic == "" {
		errorJSON(w, http.StatusBadRequest, "助记码不能为空")
		return
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte(mnemonic), bcrypt.DefaultCost)
	username := "user-" + randomID(3)
	res, err := a.db.Exec(`INSERT INTO users(username, password_hash, role) VALUES(?, ?, 'user')`, username, string(hash))
	if err != nil {
		errorJSON(w, http.StatusInternalServerError, "注册失败")
		return
	}
	id, _ := res.LastInsertId()
	token, _ := a.token(id, username, "user")
	writeJSON(w, http.StatusCreated, map[string]any{"token": token, "mnemonic": mnemonic, "user": user{ID: id, Username: username, Role: "user"}})
}

func (a *app) login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Mnemonic string `json:"mnemonic"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	var u *user
	var err error
	if req.Mnemonic != "" {
		u, err = a.findUserBySecret(normalizeSecret(req.Mnemonic), false)
	} else {
		u, err = a.findUser(req.Username)
		if err == nil && bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(req.Password)) != nil {
			err = errors.New("invalid secret")
		}
	}
	if err != nil {
		errorJSON(w, http.StatusUnauthorized, "登录凭据无效")
		return
	}
	token, _ := a.token(u.ID, u.Username, u.Role)
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": u})
}

func (a *app) me(w http.ResponseWriter, r *http.Request) {
	u, _ := currentUser(r)
	if fresh, err := a.findUserByID(u.ID); err == nil {
		u = fresh
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

func (a *app) updateMySecret(w http.ResponseWriter, r *http.Request) {
	current, _ := currentUser(r)
	u, err := a.findUserByID(current.ID)
	if err != nil {
		errorJSON(w, http.StatusNotFound, "用户不存在")
		return
	}
	var req struct {
		CurrentSecret string `json:"currentSecret"`
		NewSecret     string `json:"newSecret"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	currentSecret := normalizeSecret(req.CurrentSecret)
	newSecret := normalizeSecret(req.NewSecret)
	if newSecret == "" {
		newSecret = generateMnemonic()
	}
	if newSecret == "" {
		errorJSON(w, http.StatusBadRequest, "新密钥不能为空")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(currentSecret)) != nil {
		errorJSON(w, http.StatusUnauthorized, "当前密钥不正确")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newSecret), bcrypt.DefaultCost)
	if err != nil {
		errorJSON(w, http.StatusInternalServerError, "更新失败")
		return
	}
	if _, err := a.db.Exec(`UPDATE users SET password_hash = ? WHERE id = ?`, string(hash), u.ID); err != nil {
		errorJSON(w, http.StatusInternalServerError, "更新失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"mnemonic": newSecret})
}

func (a *app) publicSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"allowAnonymousPaste": a.settingBool("allow_anonymous_paste", true),
		"siteName":            a.setting("site_name", "LetsPaste"),
	})
}

func (a *app) adminSettings(w http.ResponseWriter, r *http.Request) { a.publicSettings(w, r) }

func (a *app) updateSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AllowAnonymousPaste bool   `json:"allowAnonymousPaste"`
		SiteName            string `json:"siteName"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	a.setSetting("allow_anonymous_paste", strconv.FormatBool(req.AllowAnonymousPaste))
	if strings.TrimSpace(req.SiteName) != "" {
		a.setSetting("site_name", strings.TrimSpace(req.SiteName))
	}
	a.publicSettings(w, r)
}

func (a *app) createPaste(w http.ResponseWriter, r *http.Request) {
	u, authed := currentUser(r)
	if !authed && !a.settingBool("allow_anonymous_paste", true) {
		errorJSON(w, http.StatusForbidden, "管理员已关闭匿名 Paste")
		return
	}
	var req struct {
		Title            string `json:"title"`
		Content          string `json:"content"`
		Language         string `json:"language"`
		Format           string `json:"format"`
		IsPrivate        bool   `json:"isPrivate"`
		Password         string `json:"password"`
		BurnAfterReading bool   `json:"burnAfterReading"`
		ExpiresInMinutes *int   `json:"expiresInMinutes"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		req.Title = "Untitled"
	}
	if strings.TrimSpace(req.Content) == "" {
		errorJSON(w, http.StatusBadRequest, "内容不能为空")
		return
	}
	if req.Language == "" {
		req.Language = "plaintext"
	}
	if req.Format != "markdown" {
		req.Format = "code"
	}

	id := randomID(8)
	var passHash any
	if req.Password != "" {
		hash, _ := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		passHash = string(hash)
	}
	var expires any
	if req.ExpiresInMinutes != nil && *req.ExpiresInMinutes > 0 {
		expires = time.Now().Add(time.Duration(*req.ExpiresInMinutes) * time.Minute).UTC().Format(time.RFC3339)
	}
	var owner any
	if authed {
		owner = u.ID
	}
	_, err := a.db.Exec(`INSERT INTO pastes(id, title, content, language, format, is_private, password_hash, burn_after_reading, expires_at, owner_id)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, req.Title, req.Content, req.Language, req.Format, boolInt(req.IsPrivate), passHash, boolInt(req.BurnAfterReading), expires, owner)
	if err != nil {
		errorJSON(w, http.StatusInternalServerError, "创建失败")
		return
	}
	p, _ := a.loadPaste(id, true)
	writeJSON(w, http.StatusCreated, p)
}

func (a *app) getPaste(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, protected, err := a.viewPaste(id, "")
	if err != nil {
		errorJSON(w, http.StatusNotFound, "Paste 不存在或已过期")
		return
	}
	if protected {
		writeJSON(w, http.StatusLocked, map[string]any{"id": id, "requiresPassword": true})
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (a *app) unlockPaste(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	p, protected, err := a.viewPaste(chi.URLParam(r, "id"), req.Password)
	if err != nil {
		errorJSON(w, http.StatusNotFound, "Paste 不存在或已过期")
		return
	}
	if protected {
		errorJSON(w, http.StatusUnauthorized, "密码错误")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (a *app) viewPaste(id, password string) (*paste, bool, error) {
	var passwordHash sql.NullString
	var burn int
	p, err := a.loadPasteRaw(id, &passwordHash, &burn)
	if err != nil {
		return nil, false, err
	}
	if p.ExpiresAt != nil {
		expires, err := time.Parse(time.RFC3339, *p.ExpiresAt)
		if err == nil && time.Now().UTC().After(expires) {
			a.db.Exec(`DELETE FROM pastes WHERE id = ?`, id)
			return nil, false, errors.New("expired")
		}
	}
	if passwordHash.Valid {
		if password == "" || bcrypt.CompareHashAndPassword([]byte(passwordHash.String), []byte(password)) != nil {
			p.Content = ""
			return p, true, nil
		}
	}
	a.db.Exec(`UPDATE pastes SET views = views + 1 WHERE id = ?`, id)
	p.Views++
	if burn == 1 {
		a.db.Exec(`DELETE FROM pastes WHERE id = ?`, id)
	}
	return p, false, nil
}

func (a *app) listPastes(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(`SELECT p.id, p.title, '', p.language, p.format, p.is_private, p.password_hash IS NOT NULL, p.burn_after_reading,
		p.expires_at, p.views, p.owner_id, u.username, p.created_at FROM pastes p LEFT JOIN users u ON p.owner_id = u.id
		WHERE p.is_private = 0 AND (p.expires_at IS NULL OR p.expires_at > ?) ORDER BY p.created_at DESC LIMIT 50`, time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		errorJSON(w, http.StatusInternalServerError, "读取失败")
		return
	}
	defer rows.Close()
	writeJSON(w, http.StatusOK, scanPastes(rows))
}

func (a *app) myPastes(w http.ResponseWriter, r *http.Request) {
	u, _ := currentUser(r)
	rows, err := a.db.Query(`SELECT p.id, p.title, '', p.language, p.format, p.is_private, p.password_hash IS NOT NULL, p.burn_after_reading,
		p.expires_at, p.views, p.owner_id, u.username, p.created_at FROM pastes p LEFT JOIN users u ON p.owner_id = u.id
		WHERE p.owner_id = ? ORDER BY p.created_at DESC`, u.ID)
	if err != nil {
		errorJSON(w, http.StatusInternalServerError, "读取失败")
		return
	}
	defer rows.Close()
	writeJSON(w, http.StatusOK, scanPastes(rows))
}

func (a *app) adminPastes(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where := []string{"1 = 1"}
	args := []any{}
	if search := strings.TrimSpace(q.Get("search")); search != "" {
		where = append(where, "(p.title LIKE ? OR p.id LIKE ? OR u.username LIKE ?)")
		like := "%" + search + "%"
		args = append(args, like, like, like)
	}
	switch q.Get("visibility") {
	case "public":
		where = append(where, "p.is_private = 0")
	case "private":
		where = append(where, "p.is_private = 1")
	}
	switch q.Get("security") {
	case "password":
		where = append(where, "p.password_hash IS NOT NULL")
	case "burn":
		where = append(where, "p.burn_after_reading = 1")
	case "expired":
		where = append(where, "p.expires_at IS NOT NULL AND p.expires_at <= ?")
		args = append(args, time.Now().UTC().Format(time.RFC3339))
	case "active":
		where = append(where, "(p.expires_at IS NULL OR p.expires_at > ?)")
		args = append(args, time.Now().UTC().Format(time.RFC3339))
	}
	if format := q.Get("format"); format == "code" || format == "markdown" {
		where = append(where, "p.format = ?")
		args = append(args, format)
	}
	orderBy := "p.created_at DESC"
	switch q.Get("sort") {
	case "views":
		orderBy = "p.views DESC, p.created_at DESC"
	case "title":
		orderBy = "p.title ASC"
	}
	query := `SELECT p.id, p.title, '', p.language, p.format, p.is_private, p.password_hash IS NOT NULL, p.burn_after_reading,
		p.expires_at, p.views, p.owner_id, u.username, p.created_at FROM pastes p LEFT JOIN users u ON p.owner_id = u.id
		WHERE ` + strings.Join(where, " AND ") + ` ORDER BY ` + orderBy + ` LIMIT 250`
	rows, err := a.db.Query(query, args...)
	if err != nil {
		errorJSON(w, http.StatusInternalServerError, "读取失败")
		return
	}
	defer rows.Close()
	writeJSON(w, http.StatusOK, scanPastes(rows))
}

func (a *app) deletePaste(w http.ResponseWriter, r *http.Request) {
	a.db.Exec(`DELETE FROM pastes WHERE id = ?`, chi.URLParam(r, "id"))
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) adminUsers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where := []string{"1 = 1"}
	args := []any{}
	if search := strings.TrimSpace(q.Get("search")); search != "" {
		where = append(where, "username LIKE ?")
		args = append(args, "%"+search+"%")
	}
	if role := q.Get("role"); role == "admin" || role == "user" {
		where = append(where, "role = ?")
		args = append(args, role)
	}
	rows, err := a.db.Query(`SELECT id, username, '', role, created_at FROM users WHERE `+strings.Join(where, " AND ")+` ORDER BY created_at DESC LIMIT 250`, args...)
	if err != nil {
		errorJSON(w, http.StatusInternalServerError, "读取失败")
		return
	}
	defer rows.Close()
	users := []user{}
	for rows.Next() {
		var u user
		rows.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.CreatedAt)
		users = append(users, u)
	}
	writeJSON(w, http.StatusOK, users)
}

func (a *app) adminStats(w http.ResponseWriter, r *http.Request) {
	now := time.Now().UTC().Format(time.RFC3339)
	stats := map[string]int64{}
	queries := map[string]string{
		"totalPastes":     `SELECT COUNT(*) FROM pastes`,
		"publicPastes":    `SELECT COUNT(*) FROM pastes WHERE is_private = 0`,
		"privatePastes":   `SELECT COUNT(*) FROM pastes WHERE is_private = 1`,
		"passwordPastes":  `SELECT COUNT(*) FROM pastes WHERE password_hash IS NOT NULL`,
		"burnPastes":      `SELECT COUNT(*) FROM pastes WHERE burn_after_reading = 1`,
		"markdownPastes":  `SELECT COUNT(*) FROM pastes WHERE format = 'markdown'`,
		"anonymousPastes": `SELECT COUNT(*) FROM pastes WHERE owner_id IS NULL`,
		"totalUsers":      `SELECT COUNT(*) FROM users`,
		"adminUsers":      `SELECT COUNT(*) FROM users WHERE role = 'admin'`,
		"totalViews":      `SELECT COALESCE(SUM(views), 0) FROM pastes`,
		"expiredPastes":   `SELECT COUNT(*) FROM pastes WHERE expires_at IS NOT NULL AND expires_at <= ?`,
		"activeExpiring":  `SELECT COUNT(*) FROM pastes WHERE expires_at IS NOT NULL AND expires_at > ?`,
		"createdToday":    `SELECT COUNT(*) FROM pastes WHERE created_at >= datetime('now', '-1 day')`,
	}
	for key, query := range queries {
		var count int64
		var err error
		if strings.Contains(query, "?") {
			err = a.db.QueryRow(query, now).Scan(&count)
		} else {
			err = a.db.QueryRow(query).Scan(&count)
		}
		if err == nil {
			stats[key] = count
		}
	}
	writeJSON(w, http.StatusOK, stats)
}

func (a *app) adminDeleteUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	u, _ := currentUser(r)
	if strconv.FormatInt(u.ID, 10) == id {
		errorJSON(w, http.StatusBadRequest, "不能删除当前管理员")
		return
	}
	a.db.Exec(`DELETE FROM users WHERE id = ? AND role != 'admin'`, id)
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) adminUpdateUserRole(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Role string `json:"role"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Role != "admin" && req.Role != "user" {
		errorJSON(w, http.StatusBadRequest, "role must be admin or user")
		return
	}
	current, _ := currentUser(r)
	if strconv.FormatInt(current.ID, 10) == id && req.Role != "admin" {
		errorJSON(w, http.StatusBadRequest, "不能移除当前管理员权限")
		return
	}
	if req.Role != "admin" {
		var adminCount int
		if err := a.db.QueryRow(`SELECT COUNT(*) FROM users WHERE role = 'admin'`).Scan(&adminCount); err == nil && adminCount <= 1 {
			var oldRole string
			a.db.QueryRow(`SELECT role FROM users WHERE id = ?`, id).Scan(&oldRole)
			if oldRole == "admin" {
				errorJSON(w, http.StatusBadRequest, "至少保留一个管理员")
				return
			}
		}
	}
	res, err := a.db.Exec(`UPDATE users SET role = ? WHERE id = ?`, req.Role, id)
	if err != nil {
		errorJSON(w, http.StatusInternalServerError, "更新失败")
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		errorJSON(w, http.StatusNotFound, "用户不存在")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (a *app) loadPaste(id string, includeContent bool) (*paste, error) {
	var passwordHash sql.NullString
	var burn int
	p, err := a.loadPasteRaw(id, &passwordHash, &burn)
	if err != nil {
		return nil, err
	}
	if !includeContent {
		p.Content = ""
	}
	return p, nil
}

func (a *app) loadPasteRaw(id string, passwordHash *sql.NullString, burn *int) (*paste, error) {
	row := a.db.QueryRow(`SELECT p.id, p.title, p.content, p.language, p.format, p.is_private, p.password_hash, p.password_hash IS NOT NULL,
		p.burn_after_reading, p.expires_at, p.views, p.owner_id, u.username, p.created_at
		FROM pastes p LEFT JOIN users u ON p.owner_id = u.id WHERE p.id = ?`, id)
	p := &paste{}
	var privateInt, hasPassword int
	var expires sql.NullString
	var owner sql.NullInt64
	var ownerName sql.NullString
	if err := row.Scan(&p.ID, &p.Title, &p.Content, &p.Language, &p.Format, &privateInt, passwordHash, &hasPassword, burn, &expires, &p.Views, &owner, &ownerName, &p.CreatedAt); err != nil {
		return nil, err
	}
	p.IsPrivate = privateInt == 1
	p.HasPassword = hasPassword == 1
	p.BurnAfterReading = *burn == 1
	if expires.Valid {
		p.ExpiresAt = &expires.String
	}
	if owner.Valid {
		p.OwnerID = &owner.Int64
	}
	if ownerName.Valid {
		p.OwnerUsername = &ownerName.String
	}
	return p, nil
}

func scanPastes(rows *sql.Rows) []paste {
	out := []paste{}
	for rows.Next() {
		var p paste
		var privateInt, hasPassword, burn int
		var expires sql.NullString
		var owner sql.NullInt64
		var ownerName sql.NullString
		rows.Scan(&p.ID, &p.Title, &p.Content, &p.Language, &p.Format, &privateInt, &hasPassword, &burn, &expires, &p.Views, &owner, &ownerName, &p.CreatedAt)
		p.IsPrivate = privateInt == 1
		p.HasPassword = hasPassword == 1
		p.BurnAfterReading = burn == 1
		if expires.Valid {
			p.ExpiresAt = &expires.String
		}
		if owner.Valid {
			p.OwnerID = &owner.Int64
		}
		if ownerName.Valid {
			p.OwnerUsername = &ownerName.String
		}
		out = append(out, p)
	}
	return out
}

func (a *app) findUser(username string) (*user, error) {
	u := &user{}
	err := a.db.QueryRow(`SELECT id, username, password_hash, role, created_at FROM users WHERE username = ?`, username).
		Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.CreatedAt)
	return u, err
}

func (a *app) findUserByID(id int64) (*user, error) {
	u := &user{}
	err := a.db.QueryRow(`SELECT id, username, password_hash, role, created_at FROM users WHERE id = ?`, id).
		Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.CreatedAt)
	return u, err
}

func (a *app) findUserBySecret(secret string, includeAdmins bool) (*user, error) {
	if secret == "" {
		return nil, errors.New("missing secret")
	}
	rows, err := a.db.Query(`SELECT id, username, password_hash, role, created_at FROM users ORDER BY id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var u user
		if err := rows.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.CreatedAt); err != nil {
			return nil, err
		}
		if !includeAdmins && u.Role == "admin" {
			continue
		}
		if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(secret)) == nil {
			return &u, nil
		}
	}
	return nil, errors.New("invalid secret")
}

func (a *app) token(id int64, username, role string) (string, error) {
	c := claims{UserID: id, Username: username, Role: role, RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(time.Now().Add(7 * 24 * time.Hour))}}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(a.jwtSecret)
}

func (a *app) optionalAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token := bearer(r); token != "" {
			if u, err := a.userFromToken(token); err == nil {
				r = r.WithContext(withUser(r.Context(), u))
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (a *app) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, err := a.userFromToken(bearer(r))
		if err != nil {
			errorJSON(w, http.StatusUnauthorized, "请先登录")
			return
		}
		next.ServeHTTP(w, r.WithContext(withUser(r.Context(), u)))
	})
}

func (a *app) requireAdmin(next http.Handler) http.Handler {
	return a.requireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, _ := currentUser(r)
		if u.Role != "admin" {
			errorJSON(w, http.StatusForbidden, "需要管理员权限")
			return
		}
		next.ServeHTTP(w, r)
	}))
}

func (a *app) userFromToken(raw string) (*user, error) {
	if raw == "" {
		return nil, errors.New("missing token")
	}
	parsed, err := jwt.ParseWithClaims(raw, &claims{}, func(token *jwt.Token) (any, error) { return a.jwtSecret, nil })
	if err != nil || !parsed.Valid {
		return nil, errors.New("invalid token")
	}
	c := parsed.Claims.(*claims)
	return &user{ID: c.UserID, Username: c.Username, Role: c.Role}, nil
}

type contextKey string

func withUser(ctx context.Context, u *user) context.Context {
	return context.WithValue(ctx, contextKey("user"), u)
}

func currentUser(r *http.Request) (*user, bool) {
	u, ok := r.Context().Value(contextKey("user")).(*user)
	return u, ok
}

func bearer(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return ""
}

func (a *app) setting(key, fallback string) string {
	var value string
	if err := a.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&value); err != nil {
		return fallback
	}
	return value
}

func (a *app) settingBool(key string, fallback bool) bool {
	value := a.setting(key, strconv.FormatBool(fallback))
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func (a *app) setSetting(key, value string) {
	a.db.Exec(`INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", env("CORS_ORIGIN", "*"))
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		errorJSON(w, http.StatusBadRequest, "请求 JSON 无效")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(payload)
}

func errorJSON(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func env(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func randomID(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

var mnemonicWords = []string{
	"river", "stone", "maple", "silver", "harbor", "cloud", "ember", "north",
	"paper", "orbit", "field", "signal", "copper", "meadow", "summit", "lantern",
	"forest", "anchor", "bright", "violet", "pencil", "canyon", "winter", "rocket",
	"garden", "velvet", "island", "window", "planet", "breeze", "coral", "metric",
}

func generateMnemonic() string {
	words := make([]string, 6)
	for i := range words {
		b := []byte{0}
		if _, err := rand.Read(b); err != nil {
			words[i] = mnemonicWords[(time.Now().Nanosecond()+i)%len(mnemonicWords)]
			continue
		}
		words[i] = mnemonicWords[int(b[0])%len(mnemonicWords)]
	}
	return strings.Join(words, "-")
}

func normalizeSecret(secret string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(secret)), "-")
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func serveSPA(r chi.Router, staticDir string) {
	fileServer := http.FileServer(http.Dir(staticDir))
	r.NotFound(func(w http.ResponseWriter, req *http.Request) {
		if strings.HasPrefix(req.URL.Path, "/api/") {
			http.NotFound(w, req)
			return
		}
		path := filepath.Join(staticDir, filepath.Clean(req.URL.Path))
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			fileServer.ServeHTTP(w, req)
			return
		}
		http.ServeFile(w, req, filepath.Join(staticDir, "index.html"))
	})
}
