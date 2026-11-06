// Package store persists the database as a single JSON file. Writes are atomic
// (temp file + rename) and serialized, so a crash never leaves a half-written file.
package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/scriptkinder88/swift-iso-analyser/internal/model"
)

type Store struct {
	mu   sync.RWMutex
	path string
	db   model.Database
}

// Open loads the database from path. If the file does not exist it is created
// from seed. An empty path keeps everything in memory.
func Open(path string, seed model.Database) (*Store, error) {
	s := &Store{path: path}
	if path == "" {
		s.db = seed
		return s, nil
	}
	raw, err := os.ReadFile(path)
	switch {
	case errors.Is(err, os.ErrNotExist):
		s.db = seed
		if err := s.saveLocked(); err != nil {
			return nil, err
		}
	case err != nil:
		return nil, fmt.Errorf("read store: %w", err)
	default:
		if err := json.Unmarshal(raw, &s.db); err != nil {
			return nil, fmt.Errorf("parse store %s: %w", path, err)
		}
	}
	return s, nil
}

// Read gives fn a read-only view of the database. fn must not retain or modify it.
func (s *Store) Read(fn func(db model.Database)) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	fn(s.db)
}

// Write applies fn to a copy of the database. The copy replaces the stored
// database and is saved only if fn returns nil.
func (s *Store) Write(fn func(db *model.Database) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	work, err := clone(s.db)
	if err != nil {
		return err
	}
	if err := fn(&work); err != nil {
		return err
	}
	prev := s.db
	s.db = work
	if err := s.saveLocked(); err != nil {
		s.db = prev
		return err
	}
	return nil
}

func (s *Store) saveLocked() error {
	if s.path == "" {
		return nil
	}
	raw, err := json.MarshalIndent(s.db, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func clone(db model.Database) (model.Database, error) {
	var out model.Database
	raw, err := json.Marshal(db)
	if err != nil {
		return out, err
	}
	err = json.Unmarshal(raw, &out)
	return out, err
}
