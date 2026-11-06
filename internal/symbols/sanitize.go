// Package symbols cleans uploaded vendor SVG symbols. It keeps only a
// drawing-safe subset of SVG: no scripts, no foreign content, no external
// references. Output is re-serialized from the token stream, so the stored
// markup is always well-formed.
package symbols

import (
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
)

const (
	MaxBytes    = 64 << 10
	maxElements = 2000
	svgNS       = "http://www.w3.org/2000/svg"
)

var allowedElements = map[string]bool{
	"svg": true, "g": true, "path": true, "rect": true, "circle": true, "ellipse": true,
	"line": true, "polyline": true, "polygon": true, "text": true, "tspan": true,
	"title": true, "desc": true, "defs": true, "linearGradient": true, "radialGradient": true,
	"stop": true, "clipPath": true,
}

var allowedAttrs = map[string]bool{
	"id": true, "class": true, "d": true, "x": true, "y": true, "x1": true, "y1": true,
	"x2": true, "y2": true, "cx": true, "cy": true, "r": true, "rx": true, "ry": true,
	"width": true, "height": true, "points": true, "transform": true, "fill": true,
	"fill-opacity": true, "fill-rule": true, "stroke": true, "stroke-width": true,
	"stroke-linecap": true, "stroke-linejoin": true, "stroke-dasharray": true,
	"stroke-opacity": true, "opacity": true, "font-size": true, "font-family": true,
	"font-weight": true, "text-anchor": true, "offset": true, "stop-color": true,
	"stop-opacity": true, "gradientUnits": true, "gradientTransform": true,
	"cx-gradient": true, "clip-path": true, "clip-rule": true, "dx": true, "dy": true,
	"viewBox": true, "preserveAspectRatio": true, "style": true,
}

var (
	viewBoxRe = regexp.MustCompile(`^-?[0-9.]+( -?[0-9.]+){3}$`)
	idRefRe   = regexp.MustCompile(`^url\(#[A-Za-z0-9_-]+\)$`)
)

// Result is the sanitized symbol.
type Result struct {
	ViewBox string
	SVG     string
}

// Sanitize validates and cleans an uploaded SVG document.
func Sanitize(raw string) (Result, error) {
	if len(raw) == 0 {
		return Result{}, errors.New("empty SVG file")
	}
	if len(raw) > MaxBytes {
		return Result{}, fmt.Errorf("SVG file is too large (max %d KB)", MaxBytes>>10)
	}
	dec := xml.NewDecoder(strings.NewReader(raw))
	dec.Strict = true

	var out strings.Builder
	var viewBox string
	elements := 0
	skipDepth := 0 // >0 while inside a disallowed element
	depth := 0

	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return Result{}, fmt.Errorf("invalid SVG: %w", err)
		}
		switch t := tok.(type) {
		case xml.StartElement:
			depth++
			if depth == 1 {
				if t.Name.Local != "svg" || (t.Name.Space != "" && t.Name.Space != svgNS) {
					return Result{}, errors.New("the root element must be <svg>")
				}
				for _, a := range t.Attr {
					if a.Name.Local == "viewBox" && a.Name.Space == "" {
						viewBox = strings.TrimSpace(a.Value)
					}
				}
				if !viewBoxRe.MatchString(viewBox) {
					return Result{}, errors.New("the SVG needs a numeric viewBox attribute, e.g. \"0 0 48 48\"")
				}
				out.WriteString(`<svg xmlns="` + svgNS + `" viewBox="` + viewBox + `">`)
				continue
			}
			if skipDepth > 0 {
				skipDepth++
				continue
			}
			elements++
			if elements > maxElements {
				return Result{}, errors.New("SVG is too complex")
			}
			name := t.Name.Local
			if (t.Name.Space != "" && t.Name.Space != svgNS) || !allowedElements[name] {
				skipDepth = 1
				continue
			}
			out.WriteString("<" + name)
			for _, a := range t.Attr {
				if a.Name.Space != "" || !allowedAttrs[a.Name.Local] || !safeValue(a.Value) {
					continue
				}
				out.WriteString(" " + a.Name.Local + `="`)
				xmlEscape(&out, a.Value)
				out.WriteString(`"`)
			}
			out.WriteString(">")
		case xml.EndElement:
			if skipDepth > 0 {
				skipDepth--
				depth--
				continue
			}
			depth--
			if depth == 0 {
				out.WriteString("</svg>")
				continue
			}
			if allowedElements[t.Name.Local] {
				out.WriteString("</" + t.Name.Local + ">")
			}
		case xml.CharData:
			if skipDepth == 0 && depth > 1 {
				xmlEscape(&out, string(t))
			}
		default:
			// comments, processing instructions and directives are dropped
		}
	}
	if depth != 0 || !strings.HasSuffix(out.String(), "</svg>") {
		return Result{}, errors.New("SVG is incomplete")
	}
	return Result{ViewBox: viewBox, SVG: out.String()}, nil
}

// safeValue rejects attribute values that could load or run something.
func safeValue(v string) bool {
	low := strings.ToLower(v)
	if strings.Contains(low, "javascript:") || strings.Contains(low, "expression(") ||
		strings.Contains(low, "@import") || strings.Contains(low, "<") {
		return false
	}
	// url(...) is allowed only as an internal fragment reference.
	for i := strings.Index(low, "url("); i >= 0; {
		end := strings.Index(low[i:], ")")
		if end < 0 {
			return false
		}
		if !idRefRe.MatchString(v[i : i+end+1]) {
			return false
		}
		next := strings.Index(low[i+end:], "url(")
		if next < 0 {
			break
		}
		i = i + end + next
	}
	return true
}

func xmlEscape(b *strings.Builder, s string) {
	var tmp strings.Builder
	_ = xml.EscapeText(&tmp, []byte(s))
	b.WriteString(tmp.String())
}
