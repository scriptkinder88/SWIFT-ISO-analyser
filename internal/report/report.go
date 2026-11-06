// Package report turns the database into the slides of the audit deck.
package report

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/scriptkinder88/swift-iso-analyser/internal/model"
	"github.com/scriptkinder88/swift-iso-analyser/internal/pptx"
)

// rowsPerSlide keeps tables readable on one slide.
const rowsPerSlide = 11

// BuildDeck returns the slides: cover, architecture, flows, one or more slides
// per control, and one slide per component with its inventory and assessments.
func BuildDeck(db model.Database, generated time.Time) []pptx.Slide {
	footer := fmt.Sprintf("%s · generato il %s · BOZZA da verificare con il CSCF corrente",
		db.Architecture.Name, generated.Format("2006-01-02"))
	var slides []pptx.Slide

	slides = append(slides, pptx.Slide{
		Title: "Valutazione " + db.Framework.Name,
		Bullets: []string{
			"Architettura: " + db.Architecture.Name,
			fmt.Sprintf("Componenti: %d · Flussi: %d", len(db.Architecture.Components), len(db.Architecture.Edges)),
			fmt.Sprintf("Requisiti nel framework: %d", countRequirements(db.Framework)),
			"Documento di lavoro per l'auditor: gli esiti sono una proposta, non una dichiarazione di conformità.",
		},
		Footer: footer,
	})

	// Architecture inventory.
	archRows := [][]string{}
	for _, c := range db.Architecture.Components {
		agent := c.AgentID
		if agent == "" {
			agent = "—"
		}
		archRows = append(archRows, []string{c.Name, c.Kind, c.Zone, agent, fmt.Sprint(len(c.Controls))})
	}
	for _, s := range chunk("Architettura: componenti", []string{"Componente", "Tipo", "Zona", "Agent Wazuh", "Requisiti mappati"},
		archRows, []int{3, 2, 2, 1, 1}, footer) {
		slides = append(slides, s)
	}

	// Flows.
	nameOf := map[string]string{}
	for _, c := range db.Architecture.Components {
		nameOf[c.ID] = c.Name
	}
	var flowRows [][]string
	for _, e := range db.Architecture.Edges {
		flowRows = append(flowRows, []string{nameOf[e.From], nameOf[e.To], e.Label})
	}
	if len(flowRows) > 0 {
		for _, s := range chunk("Architettura: flussi di dati", []string{"Da", "A", "Descrizione"}, flowRows, []int{3, 3, 3}, footer) {
			slides = append(slides, s)
		}
	}

	// Controls and requirements, with the aggregate status across mapped components.
	for _, ctl := range db.Framework.Controls {
		var rows [][]string
		for _, req := range ctl.Requirements {
			status, _ := db.StatusFor(req.ID, "")
			mandatory := "advisory"
			if req.Mandatory {
				mandatory = "obbligatorio"
			}
			rows = append(rows, []string{
				req.ID, req.Text, mandatory, label(status), fmt.Sprint(len(db.ComponentsFor(req.ID))),
			})
		}
		title := fmt.Sprintf("Controllo %s · %s", ctl.ID, ctl.Title)
		for _, s := range chunk(title, []string{"Sotto-punto", "Requisito", "Tipo", "Esito globale", "Componenti"},
			rows, []int{1, 5, 2, 2, 2}, footer) {
			slides = append(slides, s)
		}
	}

	// Per component.
	comps := append([]model.Component(nil), db.Architecture.Components...)
	sort.SliceStable(comps, func(i, j int) bool { return comps[i].Name < comps[j].Name })
	for _, c := range comps {
		bullets := []string{
			fmt.Sprintf("Tipo: %s · Zona: %s", c.Kind, c.Zone),
		}
		if c.OS != "" {
			bullets = append(bullets, "Sistema operativo: "+c.OS)
		}
		if c.Parent != "" {
			bullets = append(bullets, "Ospitato in: "+nameOf[c.Parent])
		}
		if c.AgentID != "" {
			bullets = append(bullets, "Agent Wazuh: "+c.AgentID)
		}
		bullets = append(bullets, inventorySummary(db.Inventory[c.ID])...)

		var rows [][]string
		for _, reqID := range c.Controls {
			status, rationale := db.StatusFor(reqID, c.ID)
			rows = append(rows, []string{reqID, label(status), truncate(rationale, 90)})
		}
		if len(rows) == 0 {
			bullets = append(bullets, "Nessun requisito mappato su questo componente.")
		}
		var tbl *pptx.Table
		if len(rows) > 0 {
			tbl = &pptx.Table{
				Header:     []string{"Sotto-punto", "Esito", "Motivazione"},
				Rows:       rows,
				ColWeights: []int{1, 2, 5},
			}
		}
		slides = append(slides, pptx.Slide{
			Title:   "Componente: " + c.Name,
			Bullets: bullets,
			Table:   tbl,
			Footer:  footer,
		})
	}
	return slides
}

// chunk splits rows into one or more slides with the same table header.
func chunk(title string, header []string, rows [][]string, weights []int, footer string) []pptx.Slide {
	if len(rows) == 0 {
		return []pptx.Slide{{
			Title:   title,
			Bullets: []string{"Nessun dato disponibile."},
			Footer:  footer,
		}}
	}
	var out []pptx.Slide
	for start, part := 0, 1; start < len(rows); start, part = start+rowsPerSlide, part+1 {
		end := start + rowsPerSlide
		if end > len(rows) {
			end = len(rows)
		}
		t := title
		if len(rows) > rowsPerSlide {
			t = fmt.Sprintf("%s (%d/%d)", title, part, (len(rows)+rowsPerSlide-1)/rowsPerSlide)
		}
		out = append(out, pptx.Slide{
			Title:  t,
			Table:  &pptx.Table{Header: header, Rows: rows[start:end], ColWeights: weights},
			Footer: footer,
		})
	}
	return out
}

func inventorySummary(items []model.InventoryItem) []string {
	if len(items) == 0 {
		return []string{"Inventory: nessun dato (eseguire la sincronizzazione Wazuh o inserire i dati manualmente)."}
	}
	counts := map[string]int{}
	var hw, os string
	for _, it := range items {
		counts[it.Category]++
		switch it.Category {
		case "hardware":
			if hw == "" {
				hw = fmt.Sprintf("CPU %s · RAM %s · seriale %s",
					it.Fields["cpu.name"], it.Fields["ram.total"], it.Fields["board_serial"])
			}
		case "os":
			if os == "" {
				os = fmt.Sprintf("%s %s (kernel %s)",
					it.Fields["os.name"], it.Fields["os.version"], it.Fields["os.kernel.release"])
			}
		}
	}
	out := []string{}
	if hw != "" {
		out = append(out, "Hardware: "+hw)
	}
	if os != "" {
		out = append(out, "Sistema operativo: "+os)
	}
	out = append(out, fmt.Sprintf("Pacchetti: %d · Porte in ascolto: %d", counts["packages"], counts["ports"]))
	return out
}

func label(s model.Status) string {
	switch s {
	case model.StatusCompliant:
		return "Conforme"
	case model.StatusPartial:
		return "Parziale"
	case model.StatusNonCompliant:
		return "Non conforme"
	case model.StatusNotApplicable:
		return "N/A"
	default:
		return "Da valutare"
	}
}

func countRequirements(f model.Framework) int {
	n := 0
	for _, c := range f.Controls {
		n += len(c.Requirements)
	}
	return n
}

func truncate(s string, n int) string {
	s = strings.TrimSpace(s)
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}
