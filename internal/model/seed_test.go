package model_test

import (
	"encoding/json"
	"testing"

	"github.com/scriptkinder88/swift-iso-analyser/data"
	"github.com/scriptkinder88/swift-iso-analyser/internal/model"
)

func loadSeed(t *testing.T) model.Database {
	t.Helper()
	var db model.Database
	if err := json.Unmarshal(data.SwiftCSCF, &db.Framework); err != nil {
		t.Fatalf("framework JSON: %v", err)
	}
	if err := json.Unmarshal(data.SampleArchitecture, &db.Architecture); err != nil {
		t.Fatalf("architecture JSON: %v", err)
	}
	return db
}

func TestSeedIsConsistent(t *testing.T) {
	db := loadSeed(t)
	if problems := db.Validate(); len(problems) > 0 {
		t.Fatalf("seed has integrity problems: %v", problems)
	}
	if len(db.Architecture.Components) == 0 || len(db.Architecture.Edges) == 0 {
		t.Fatal("sample architecture is empty")
	}
}

func TestValidateDetectsBrokenReferences(t *testing.T) {
	db := loadSeed(t)
	db.Architecture.Edges = append(db.Architecture.Edges, model.Edge{From: "nope", To: "fw-edge"})
	db.Architecture.Components[0].Controls = []string{"9.9.9"}
	problems := db.Validate()
	if len(problems) < 2 {
		t.Fatalf("expected problems for unknown edge and requirement, got %v", problems)
	}
}

func TestStatusForPrefersComponentOverGlobal(t *testing.T) {
	db := loadSeed(t)
	db.Assessments = []model.Assessment{
		{RequirementID: "1.4.1", Status: model.StatusCompliant, Rationale: "globale"},
		{RequirementID: "1.4.1", ComponentID: "fw-edge", Status: model.StatusNonCompliant, Rationale: "locale"},
	}
	st, why := db.StatusFor("1.4.1", "fw-edge")
	if st != model.StatusNonCompliant || why != "locale" {
		t.Fatalf("component assessment not preferred: %s %q", st, why)
	}
	st, _ = db.StatusFor("1.4.1", "proxy-web")
	if st != model.StatusCompliant {
		t.Fatalf("global assessment not used as fallback: %s", st)
	}
	st, _ = db.StatusFor("2.2.1", "")
	if st != model.StatusNotAssessed {
		t.Fatalf("expected not assessed, got %s", st)
	}
}

func TestValidateContainerNesting(t *testing.T) {
	db := loadSeed(t)
	db.Architecture.Components = append(db.Architecture.Components,
		model.Component{ID: "k8s", Name: "Nodo K8s", Kind: "vm", Zone: "Zona SWIFT", Symbol: "server", OS: "RHEL 9.4"},
		model.Component{ID: "api", Name: "API messaggi", Kind: "container", Zone: "Zona SWIFT", Symbol: "container", Parent: "k8s"},
	)
	if problems := db.Validate(); len(problems) > 0 {
		t.Fatalf("valid nesting rejected: %v", problems)
	}

	db.Architecture.Components[len(db.Architecture.Components)-1].Parent = "api"
	if problems := db.Validate(); len(problems) == 0 {
		t.Fatal("self-containment not rejected")
	}

	db.Architecture.Components[len(db.Architecture.Components)-1].Parent = "swift-db"
	db.Architecture.Components[len(db.Architecture.Components)-2].Parent = "api"
	if problems := db.Validate(); len(problems) == 0 {
		t.Fatal("two-level nesting not rejected")
	}
}
