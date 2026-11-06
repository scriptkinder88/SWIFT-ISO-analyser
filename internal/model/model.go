// Package model defines the domain objects: framework (SWIFT CSCF), components
// of the architecture, inventory collected from discovery, and assessments.
package model

import "time"

// Status of a requirement assessed by an auditor.
type Status string

const (
	StatusNotAssessed   Status = "non_valutato"
	StatusCompliant     Status = "conforme"
	StatusPartial       Status = "parzialmente_conforme"
	StatusNonCompliant  Status = "non_conforme"
	StatusNotApplicable Status = "non_applicabile"
)

// ValidStatus reports whether s is one of the accepted statuses.
func ValidStatus(s Status) bool {
	switch s {
	case StatusNotAssessed, StatusCompliant, StatusPartial, StatusNonCompliant, StatusNotApplicable:
		return true
	}
	return false
}

// Framework is a versioned set of controls (e.g. SWIFT CSCF).
type Framework struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Version  string    `json:"version"`
	Note     string    `json:"note,omitempty"`
	Controls []Control `json:"controls"`
}

// Control is a top-level control, e.g. "1.4 Restriction of Internet Access".
type Control struct {
	ID           string        `json:"id"`
	Title        string        `json:"title"`
	Requirements []Requirement `json:"requirements"`
}

// Requirement is a testable sub-point of a control.
type Requirement struct {
	ID           string   `json:"id"`
	Text         string   `json:"text"`
	Mandatory    bool     `json:"mandatory"`
	Architecture []string `json:"architecture,omitempty"` // e.g. ["A1","A2","A4"]; empty = all
}

// Component is an element of the architecture map (server, firewall, app...).
type Component struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Kind     string   `json:"kind"`             // server, network, application, database, hsm, workstation, external
	Zone     string   `json:"zone"`             // logical zone used for layout: e.g. "Internet", "DMZ", "SWIFT zone"
	Symbol   string   `json:"symbol,omitempty"` // generic symbol or "custom:<id>"
	Vendor   string   `json:"vendor,omitempty"`
	Model    string   `json:"model,omitempty"`
	OS       string   `json:"os,omitempty"`       // e.g. "RHEL 9.4", "Windows Server 2022"
	Parent   string   `json:"parent,omitempty"`   // host component id when this is a container or VM inside another component
	AgentID  string   `json:"agent_id,omitempty"` // Wazuh agent id used for discovery
	Controls []string `json:"controls,omitempty"` // requirement ids mapped to this component
}

// Edge is a data flow between two components.
type Edge struct {
	From    string `json:"from"`
	To      string `json:"to"`
	Label   string `json:"label,omitempty"`
	Network string `json:"network,omitempty"` // see NetworkTypes
}

// Architecture is the map of components and flows for one institution.
type Architecture struct {
	Name       string      `json:"name"`
	Zones      []Zone      `json:"zones,omitempty"`
	Components []Component `json:"components"`
	Edges      []Edge      `json:"edges"`
}

// InventoryItem is a fact collected for a component (hardware, OS, package...).
type InventoryItem struct {
	Category string            `json:"category"` // hardware, os, package, port, process, netiface
	Fields   map[string]string `json:"fields"`
	Source   string            `json:"source"` // "wazuh" or "manual"
	SeenAt   time.Time         `json:"seen_at"`
}

// Evidence is a manually or automatically attached proof.
type Evidence struct {
	ID            string    `json:"id"`
	ComponentID   string    `json:"component_id,omitempty"`
	RequirementID string    `json:"requirement_id"`
	Description   string    `json:"description"`
	SHA256        string    `json:"sha256,omitempty"`
	AddedAt       time.Time `json:"added_at"`
}

// Assessment is the auditor's judgement on one requirement for one component
// (ComponentID empty = global for the institution).
type Assessment struct {
	RequirementID string    `json:"requirement_id"`
	ComponentID   string    `json:"component_id,omitempty"`
	Status        Status    `json:"status"`
	Rationale     string    `json:"rationale,omitempty"`
	Auditor       string    `json:"auditor"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// Database is the whole persisted state of the tool.
type Database struct {
	Framework    Framework                  `json:"framework"`
	Architecture Architecture               `json:"architecture"`
	Inventory    map[string][]InventoryItem `json:"inventory"` // key: component id
	Evidence     []Evidence                 `json:"evidence"`
	Assessments  []Assessment               `json:"assessments"`
	Symbols      []CustomSymbol             `json:"symbols,omitempty"`
}

// RequirementIndex returns all requirements keyed by id, with their control id.
func (f Framework) RequirementIndex() map[string]struct {
	Control     Control
	Requirement Requirement
} {
	idx := map[string]struct {
		Control     Control
		Requirement Requirement
	}{}
	for _, c := range f.Controls {
		for _, r := range c.Requirements {
			idx[r.ID] = struct {
				Control     Control
				Requirement Requirement
			}{c, r}
		}
	}
	return idx
}
