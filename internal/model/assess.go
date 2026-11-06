package model

// StatusFor returns the status of a requirement for a component. A
// component-specific assessment wins over the global one (ComponentID == "").
// The second return value is the rationale of the assessment used.
func (d Database) StatusFor(requirementID, componentID string) (Status, string) {
	var global *Assessment
	for i := range d.Assessments {
		a := &d.Assessments[i]
		if a.RequirementID != requirementID {
			continue
		}
		if componentID != "" && a.ComponentID == componentID {
			return a.Status, a.Rationale
		}
		if a.ComponentID == "" {
			global = a
		}
	}
	if global != nil {
		return global.Status, global.Rationale
	}
	return StatusNotAssessed, ""
}

// ComponentsFor returns the components mapped to a requirement id.
func (d Database) ComponentsFor(requirementID string) []Component {
	var out []Component
	for _, c := range d.Architecture.Components {
		for _, r := range c.Controls {
			if r == requirementID {
				out = append(out, c)
				break
			}
		}
	}
	return out
}

// ComponentByID returns the component with the given id.
func (d Database) ComponentByID(id string) (Component, bool) {
	for _, c := range d.Architecture.Components {
		if c.ID == id {
			return c, true
		}
	}
	return Component{}, false
}

// Validate checks referential integrity of the architecture against the framework.
func (d Database) Validate() []string {
	var problems []string
	ids := map[string]bool{}
	for _, c := range d.Architecture.Components {
		if c.ID == "" {
			problems = append(problems, "componente senza id")
			continue
		}
		if ids[c.ID] {
			problems = append(problems, "id componente duplicato: "+c.ID)
		}
		ids[c.ID] = true
	}
	zones := map[string]bool{}
	for _, z := range d.Architecture.Zones {
		if !ValidNetwork(z.Network) || z.Network == "" {
			problems = append(problems, "tipo di rete non valido per la zona "+z.Name+": "+z.Network)
		}
		zones[z.Name] = true
	}
	byID := map[string]Component{}
	for _, c := range d.Architecture.Components {
		byID[c.ID] = c
	}
	for _, c := range d.Architecture.Components {
		if c.Parent == "" {
			continue
		}
		parent, ok := byID[c.Parent]
		switch {
		case !ok:
			problems = append(problems, "contenitore sconosciuto su "+c.ID+": "+c.Parent)
		case c.Parent == c.ID:
			problems = append(problems, "componente contenuto in sé stesso: "+c.ID)
		case parent.Parent != "":
			problems = append(problems, "annidamento oltre un livello non supportato: "+c.ID)
		case parent.Zone != c.Zone:
			problems = append(problems, "il contenuto "+c.ID+" deve stare nella stessa zona del contenitore "+parent.ID)
		}
	}
	for _, c := range d.Architecture.Components {
		if !d.ValidSymbol(c.Symbol) {
			problems = append(problems, "simbolo non valido su "+c.ID+": "+c.Symbol)
		}
		if len(zones) > 0 && !zones[c.Zone] {
			problems = append(problems, "zona sconosciuta su "+c.ID+": "+c.Zone)
		}
	}
	for _, e := range d.Architecture.Edges {
		if !ValidNetwork(e.Network) {
			problems = append(problems, "tipo di rete non valido sul flusso "+e.From+"->"+e.To+": "+e.Network)
		}
		if !ids[e.From] {
			problems = append(problems, "arco da componente sconosciuto: "+e.From)
		}
		if !ids[e.To] {
			problems = append(problems, "arco verso componente sconosciuto: "+e.To)
		}
	}
	reqs := d.Framework.RequirementIndex()
	for _, c := range d.Architecture.Components {
		for _, r := range c.Controls {
			if _, ok := reqs[r]; !ok {
				problems = append(problems, "requisito sconosciuto mappato su "+c.ID+": "+r)
			}
		}
	}
	for _, a := range d.Assessments {
		if _, ok := reqs[a.RequirementID]; !ok {
			problems = append(problems, "valutazione su requisito sconosciuto: "+a.RequirementID)
		}
		if !ValidStatus(a.Status) {
			problems = append(problems, "stato non valido: "+string(a.Status))
		}
	}
	return problems
}
