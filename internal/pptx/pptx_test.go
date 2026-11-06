package pptx

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"io"
	"strings"
	"testing"
)

func TestWriteProducesWellFormedPackage(t *testing.T) {
	slides := []Slide{
		{Title: "Titolo <con> & caratteri \"speciali\"", Bullets: []string{"uno", "due & tre"}, Footer: "piè di pagina"},
		{
			Title: "Tabella",
			Table: &Table{
				Header:     []string{"A", "B"},
				Rows:       [][]string{{"1", "<x>"}, {"2", "è ok"}},
				ColWeights: []int{1, 3},
			},
		},
	}
	data, err := Bytes(slides)
	if err != nil {
		t.Fatalf("Bytes: %v", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}

	want := []string{
		"[Content_Types].xml",
		"_rels/.rels",
		"ppt/presentation.xml",
		"ppt/_rels/presentation.xml.rels",
		"ppt/slideMasters/slideMaster1.xml",
		"ppt/slideLayouts/slideLayout1.xml",
		"ppt/theme/theme1.xml",
		"ppt/slides/slide1.xml",
		"ppt/slides/slide2.xml",
	}
	have := map[string][]byte{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatal(err)
		}
		have[f.Name] = body
	}
	for _, name := range want {
		if _, ok := have[name]; !ok {
			t.Errorf("missing part %s", name)
		}
	}
	for name, body := range have {
		if !strings.HasSuffix(name, ".xml") && !strings.HasSuffix(name, ".rels") {
			continue
		}
		if err := checkWellFormed(body); err != nil {
			t.Errorf("%s is not well-formed XML: %v", name, err)
		}
	}
	if !strings.Contains(string(have["ppt/slides/slide1.xml"]), "&lt;con&gt;") {
		t.Error("title text was not escaped")
	}
}

func TestEscStripsInvalidXMLChars(t *testing.T) {
	got := esc("a\x00b\x0bc")
	if strings.ContainsAny(got, "\x00\x0b") {
		t.Fatalf("control characters kept: %q", got)
	}
}

func checkWellFormed(body []byte) error {
	dec := xml.NewDecoder(bytes.NewReader(body))
	for {
		_, err := dec.Token()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

func TestWriteRejectsEmptyDeck(t *testing.T) {
	if _, err := Bytes(nil); err == nil {
		t.Fatal("expected error for empty deck")
	}
}
