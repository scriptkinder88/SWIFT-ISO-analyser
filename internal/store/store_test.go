package store

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/scriptkinder88/swift-iso-analyser/internal/model"
)

func seedDB() model.Database {
	return model.Database{
		Architecture: model.Architecture{Name: "test", Components: []model.Component{{ID: "a", Name: "A"}}},
		Inventory:    map[string][]model.InventoryItem{},
	}
}

func TestOpenCreatesFileFromSeed(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "store.json")
	st, err := Open(path, seedDB())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("store file not created: %v", err)
	}
	st.Read(func(db model.Database) {
		if db.Architecture.Name != "test" {
			t.Fatalf("seed not applied: %q", db.Architecture.Name)
		}
	})
}

func TestWriteIsPersistedAndRolledBackOnError(t *testing.T) {
	path := filepath.Join(t.TempDir(), "store.json")
	st, err := Open(path, seedDB())
	if err != nil {
		t.Fatal(err)
	}

	if err := st.Write(func(db *model.Database) error {
		db.Architecture.Name = "changed"
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	boom := errors.New("boom")
	if err := st.Write(func(db *model.Database) error {
		db.Architecture.Name = "should not persist"
		return boom
	}); !errors.Is(err, boom) {
		t.Fatalf("expected boom, got %v", err)
	}

	reopened, err := Open(path, seedDB())
	if err != nil {
		t.Fatal(err)
	}
	reopened.Read(func(db model.Database) {
		if db.Architecture.Name != "changed" {
			t.Fatalf("expected persisted value 'changed', got %q", db.Architecture.Name)
		}
	})
}
