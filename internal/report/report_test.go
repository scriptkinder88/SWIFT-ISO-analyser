package report

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/scriptkinder88/swift-iso-analyser/data"
	"github.com/scriptkinder88/swift-iso-analyser/internal/model"
	"github.com/scriptkinder88/swift-iso-analyser/internal/pptx"
)

func seed(t *testing.T) model.Database {
	t.Helper()
	var db model.Database
	if err := json.Unmarshal(data.SwiftCSCF, &db.Framework); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data.SampleArchitecture, &db.Architecture); err != nil {
		t.Fatal(err)
	}
	db.Inventory = map[string][]model.InventoryItem{
		"swift-gw": {{Category: "hardware", Fields: map[string]string{"cpu.name": "CPU", "ram.total": "64G", "board_serial": "SN1"}, Source: "wazuh"}},
	}
	return db
}

func TestBuildDeckCoversArchitectureControlsAndComponents(t *testing.T) {
	db := seed(t)
	db.Assessments = []model.Assessment{
		{RequirementID: "1.4.1", Status: model.StatusCompliant, Auditor: "test"},
		{RequirementID: "1.4.1", ComponentID: "fw-edge", Status: model.StatusNonCompliant, Rationale: "regola any-any", Auditor: "test"},
	}
	slides := BuildDeck(db, time.Date(2026, 11, 6, 0, 0, 0, 0, time.UTC))

	titles := []string{}
	for _, s := range slides {
		titles = append(titles, s.Title)
	}
	joined := strings.Join(titles, " | ")
	for _, want := range []string{"Valutazione", "Architettura: componenti", "Controllo 1.4", "Componente: SIEM"} {
		if !strings.Contains(joined, want) {
			t.Errorf("deck has no slide containing %q; titles: %s", want, joined)
		}
	}

	raw, err := pptx.Bytes(slides)
	if err != nil {
		t.Fatalf("deck does not serialize: %v", err)
	}
	if len(raw) < 1000 {
		t.Fatalf("suspiciously small package: %d bytes", len(raw))
	}
}

func TestChunkSplitsLongTables(t *testing.T) {
	var rows [][]string
	for i := 0; i < rowsPerSlide*2+3; i++ {
		rows = append(rows, []string{"x"})
	}
	slides := chunk("T", []string{"h"}, rows, nil, "")
	if len(slides) != 3 {
		t.Fatalf("expected 3 slides, got %d", len(slides))
	}
	if !strings.Contains(slides[0].Title, "(1/3)") {
		t.Fatalf("missing page counter: %q", slides[0].Title)
	}
}
