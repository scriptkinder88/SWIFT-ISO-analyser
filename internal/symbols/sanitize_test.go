package symbols

import (
	"strings"
	"testing"
)

func TestSanitizeKeepsDrawingElements(t *testing.T) {
	res, err := Sanitize(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="#fff" stroke="#000"/><text x="2" y="10">A &amp; B</text></svg>`)
	if err != nil {
		t.Fatal(err)
	}
	if res.ViewBox != "0 0 48 48" {
		t.Fatalf("viewBox %q", res.ViewBox)
	}
	for _, want := range []string{`<circle`, `r="20"`, `A &amp; B`} {
		if !strings.Contains(res.SVG, want) {
			t.Errorf("missing %q in %s", want, res.SVG)
		}
	}
}

func TestSanitizeRemovesActiveContent(t *testing.T) {
	cases := map[string]string{
		"script":        `<script>alert(1)</script>`,
		"onload":        `<rect onload="alert(1)" width="2" height="2"/>`,
		"foreignObject": `<foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src="x"/></body></foreignObject>`,
		"href":          `<a href="https://example.com"><rect width="2" height="2"/></a>`,
		"js url":        `<rect fill="url(https://evil.example/x.svg#a)" width="2" height="2"/>`,
		"style import":  `<rect style="@import 'x'" width="2" height="2"/>`,
	}
	for name, body := range cases {
		res, err := Sanitize(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">` + body + `</svg>`)
		if err != nil {
			t.Errorf("%s: unexpected error %v", name, err)
			continue
		}
		low := strings.ToLower(res.SVG)
		for _, bad := range []string{"script", "onload", "foreignobject", "href", "evil", "@import", "alert", "img"} {
			if strings.Contains(low, bad) {
				t.Errorf("%s: %q survived sanitization: %s", name, bad, res.SVG)
			}
		}
	}
}

func TestSanitizeRejectsBadDocuments(t *testing.T) {
	bad := []string{
		``,
		`<html><body/></html>`,
		`<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`,              // no viewBox
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect>`, // truncated
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect></svg>`,
	}
	for _, b := range bad {
		if _, err := Sanitize(b); err == nil {
			t.Errorf("expected rejection for %q", b)
		}
	}
}
