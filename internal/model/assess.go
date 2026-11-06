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
	for _, e := range d.Architecture.Edges {
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
