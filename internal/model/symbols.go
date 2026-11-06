package model

// Generic symbols drawn by the frontend. Anything else must be a custom symbol
// referenced as "custom:<id>".
var GenericSymbols = []string{
	"server", "firewall", "router", "switch", "hsm", "database", "workstation",
	"cloud", "internet", "appliance", "loadbalancer", "storage", "application",
}

// Network types drive the line style and zone colour in the map.
var NetworkTypes = []string{"internet", "dmz", "swift", "internal", "management", "backup"}

// CustomSymbol is an uploaded vendor symbol. SVG is stored already sanitized.
type CustomSymbol struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Vendor  string `json:"vendor,omitempty"`
	ViewBox string `json:"viewBox"`
	SVG     string `json:"svg"`
}

// Zone is a named network area with a network type.
type Zone struct {
	Name    string `json:"name"`
	Network string `json:"network"`
}

// ValidSymbol reports whether s is a generic symbol or an existing custom one.
func (d Database) ValidSymbol(s string) bool {
	if s == "" {
		return true
	}
	for _, g := range GenericSymbols {
		if s == g {
			return true
		}
	}
	if len(s) > 7 && s[:7] == "custom:" {
		for _, c := range d.Symbols {
			if "custom:"+c.ID == s {
				return true
			}
		}
	}
	return false
}

// ValidNetwork reports whether s is an accepted network type (empty allowed).
func ValidNetwork(s string) bool {
	if s == "" {
		return true
	}
	for _, n := range NetworkTypes {
		if s == n {
			return true
		}
	}
	return false
}
