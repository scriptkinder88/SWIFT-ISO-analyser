// Package api exposes the JSON API and serves the embedded web interface.
package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/scriptkinder88/swift-iso-analyser/internal/model"
	"github.com/scriptkinder88/swift-iso-analyser/internal/pptx"
	"github.com/scriptkinder88/swift-iso-analyser/internal/report"
	"github.com/scriptkinder88/swift-iso-analyser/internal/store"
	"github.com/scriptkinder88/swift-iso-analyser/internal/symbols"
	"github.com/scriptkinder88/swift-iso-analyser/internal/wazuh"
)

// Server holds the dependencies of the HTTP handlers.
type Server struct {
	Store *store.Store
	Wazuh *wazuh.Client // nil when Wazuh is not configured
	Web   fs.FS         // embedded static web files
	Now   func() time.Time
}

// Handler returns the HTTP router.
func (s *Server) Handler() http.Handler {
	if s.Now == nil {
		s.Now = time.Now
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.health)
	mux.HandleFunc("GET /api/framework", s.framework)
	mux.HandleFunc("GET /api/architecture", s.architecture)
	mux.HandleFunc("PUT /api/architecture", s.putArchitecture)
	mux.HandleFunc("GET /api/components/{id}/inventory", s.inventory)
	mux.HandleFunc("POST /api/wazuh/sync", s.syncWazuh)
	mux.HandleFunc("GET /api/symbols", s.listSymbols)
	mux.HandleFunc("POST /api/symbols", s.addSymbol)
	mux.HandleFunc("DELETE /api/symbols/{id}", s.deleteSymbol)
	mux.HandleFunc("GET /api/assessments", s.assessments)
	mux.HandleFunc("PUT /api/assessments", s.putAssessment)
	mux.HandleFunc("GET /api/report.pptx", s.reportPPTX)
	mux.Handle("GET /", http.FileServer(http.FS(s.Web)))
	return securityHeaders(mux)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func decode(w http.ResponseWriter, r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"wazuh":  s.Wazuh != nil,
	})
}

func (s *Server) framework(w http.ResponseWriter, _ *http.Request) {
	s.Store.Read(func(db model.Database) {
		writeJSON(w, http.StatusOK, db.Framework)
	})
}

func (s *Server) architecture(w http.ResponseWriter, _ *http.Request) {
	s.Store.Read(func(db model.Database) {
		writeJSON(w, http.StatusOK, db.Architecture)
	})
}

func (s *Server) putArchitecture(w http.ResponseWriter, r *http.Request) {
	var arch model.Architecture
	if err := decode(w, r, &arch); err != nil {
		writeError(w, http.StatusBadRequest, "JSON non valido: "+err.Error())
		return
	}
	err := s.Store.Write(func(db *model.Database) error {
		db.Architecture = arch
		if problems := db.Validate(); len(problems) > 0 {
			return validationError(problems)
		}
		return nil
	})
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	s.architecture(w, r)
}

type validationError []string

func (v validationError) Error() string { return strings.Join(v, "; ") }

func (s *Server) inventory(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.Store.Read(func(db model.Database) {
		if _, ok := db.ComponentByID(id); !ok {
			writeError(w, http.StatusNotFound, "componente non trovato")
			return
		}
		items := db.Inventory[id]
		if items == nil {
			items = []model.InventoryItem{}
		}
		writeJSON(w, http.StatusOK, items)
	})
}

func (s *Server) syncWazuh(w http.ResponseWriter, r *http.Request) {
	if s.Wazuh == nil {
		writeError(w, http.StatusServiceUnavailable, "Wazuh non configurato (variabili WAZUH_URL, WAZUH_USER, WAZUH_PASSWORD)")
		return
	}
	var comps []model.Component
	s.Store.Read(func(db model.Database) {
		comps = append(comps, db.Architecture.Components...)
	})
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	inv, errs := s.Wazuh.SyncAll(ctx, comps)
	now := s.Now()
	err := s.Store.Write(func(db *model.Database) error {
		if db.Inventory == nil {
			db.Inventory = map[string][]model.InventoryItem{}
		}
		for id, items := range inv {
			db.Inventory[id] = items
		}
		return nil
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	for id, msg := range errs {
		log.Printf("wazuh sync %s: %s", id, msg)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"synced":   len(inv),
		"errors":   errs,
		"syncedAt": now.UTC(),
	})
}

func (s *Server) assessments(w http.ResponseWriter, _ *http.Request) {
	s.Store.Read(func(db model.Database) {
		list := db.Assessments
		if list == nil {
			list = []model.Assessment{}
		}
		writeJSON(w, http.StatusOK, list)
	})
}

type assessmentInput struct {
	RequirementID string       `json:"requirement_id"`
	ComponentID   string       `json:"component_id"`
	Status        model.Status `json:"status"`
	Rationale     string       `json:"rationale"`
	Auditor       string       `json:"auditor"`
}

func (s *Server) putAssessment(w http.ResponseWriter, r *http.Request) {
	var in assessmentInput
	if err := decode(w, r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "JSON non valido: "+err.Error())
		return
	}
	if !model.ValidStatus(in.Status) {
		writeError(w, http.StatusBadRequest, "stato non valido")
		return
	}
	if strings.TrimSpace(in.Auditor) == "" {
		writeError(w, http.StatusBadRequest, "indicare l'auditor")
		return
	}
	if len(in.Rationale) > 4000 {
		writeError(w, http.StatusBadRequest, "motivazione troppo lunga")
		return
	}
	now := s.Now().UTC()
	err := s.Store.Write(func(db *model.Database) error {
		if _, ok := db.Framework.RequirementIndex()[in.RequirementID]; !ok {
			return fmt.Errorf("requisito sconosciuto: %s", in.RequirementID)
		}
		if in.ComponentID != "" {
			if _, ok := db.ComponentByID(in.ComponentID); !ok {
				return fmt.Errorf("componente sconosciuto: %s", in.ComponentID)
			}
		}
		a := model.Assessment{
			RequirementID: in.RequirementID,
			ComponentID:   in.ComponentID,
			Status:        in.Status,
			Rationale:     in.Rationale,
			Auditor:       in.Auditor,
			UpdatedAt:     now,
		}
		for i := range db.Assessments {
			if db.Assessments[i].RequirementID == a.RequirementID && db.Assessments[i].ComponentID == a.ComponentID {
				db.Assessments[i] = a
				return nil
			}
		}
		db.Assessments = append(db.Assessments, a)
		return nil
	})
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	s.assessments(w, r)
}

func (s *Server) reportPPTX(w http.ResponseWriter, _ *http.Request) {
	var slides []pptx.Slide
	s.Store.Read(func(db model.Database) {
		slides = report.BuildDeck(db, s.Now())
	})
	data, err := pptx.Bytes(slides)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	name := fmt.Sprintf("swift-audit-%s.pptx", s.Now().Format("2006-01-02"))
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, name))
	w.Header().Set("Content-Length", fmt.Sprint(len(data)))
	_, _ = w.Write(data)
}

// symbolsResponse lists the symbols the editor can offer.
type symbolsResponse struct {
	Generic []string             `json:"generic"`
	Custom  []model.CustomSymbol `json:"custom"`
}

func (s *Server) listSymbols(w http.ResponseWriter, _ *http.Request) {
	s.Store.Read(func(db model.Database) {
		custom := db.Symbols
		if custom == nil {
			custom = []model.CustomSymbol{}
		}
		writeJSON(w, http.StatusOK, symbolsResponse{Generic: model.GenericSymbols, Custom: custom})
	})
}

type symbolInput struct {
	Name   string `json:"name"`
	Vendor string `json:"vendor"`
	SVG    string `json:"svg"`
}

func (s *Server) addSymbol(w http.ResponseWriter, r *http.Request) {
	var in symbolInput
	if err := decode(w, r, &in); err != nil {
		writeError(w, http.StatusBadRequest, "JSON non valido: "+err.Error())
		return
	}
	name := strings.TrimSpace(in.Name)
	if name == "" || len([]rune(name)) > 80 {
		writeError(w, http.StatusBadRequest, "nome simbolo obbligatorio (max 80 caratteri)")
		return
	}
	if len([]rune(in.Vendor)) > 80 {
		writeError(w, http.StatusBadRequest, "vendor troppo lungo")
		return
	}
	clean, err := symbols.Sanitize(in.SVG)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	sum := sha256.Sum256([]byte(clean.SVG))
	sym := model.CustomSymbol{
		ID:      slug(name) + "-" + hex.EncodeToString(sum[:4]),
		Name:    name,
		Vendor:  strings.TrimSpace(in.Vendor),
		ViewBox: clean.ViewBox,
		SVG:     clean.SVG,
	}
	err = s.Store.Write(func(db *model.Database) error {
		for _, c := range db.Symbols {
			if c.ID == sym.ID {
				return errSymbolExists
			}
		}
		db.Symbols = append(db.Symbols, sym)
		return nil
	})
	if err == errSymbolExists {
		writeError(w, http.StatusConflict, "simbolo già presente")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, sym)
}

var errSymbolExists = fmt.Errorf("symbol exists")

func (s *Server) deleteSymbol(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	err := s.Store.Write(func(db *model.Database) error {
		ref := "custom:" + id
		for _, c := range db.Architecture.Components {
			if c.Symbol == ref {
				return fmt.Errorf("simbolo in uso su %s", c.Name)
			}
		}
		kept := db.Symbols[:0]
		found := false
		for _, c := range db.Symbols {
			if c.ID == id {
				found = true
				continue
			}
			kept = append(kept, c)
		}
		if !found {
			return errNotFound
		}
		db.Symbols = kept
		return nil
	})
	switch {
	case err == errNotFound:
		writeError(w, http.StatusNotFound, "simbolo non trovato")
	case err != nil && strings.HasPrefix(err.Error(), "simbolo in uso"):
		writeError(w, http.StatusConflict, err.Error())
	case err != nil:
		writeError(w, http.StatusInternalServerError, err.Error())
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

var errNotFound = fmt.Errorf("not found")

// slug turns a name into a url-safe id fragment.
func slug(s string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(s) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			if r < 128 {
				b.WriteRune(r)
				dash = false
			}
			continue
		}
		if !dash && b.Len() > 0 {
			b.WriteByte('-')
			dash = true
		}
	}
	out := strings.TrimRight(b.String(), "-")
	if out == "" {
		out = "simbolo"
	}
	if len(out) > 40 {
		out = out[:40]
	}
	return out
}
