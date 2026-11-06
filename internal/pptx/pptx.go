// Package pptx writes a minimal but valid .pptx (Office Open XML) file using only
// the standard library. It supports slides with a title, bullet text and one table.
package pptx

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"strings"
)

// Slide size: 16:9, 13.33 x 7.5 in, in EMU.
const (
	slideCX  = 12192000
	slideCY  = 6858000
	margin   = 457200
	contentW = slideCX - 2*margin
)

// Table is a simple grid. ColWeights are relative widths (defaults to equal).
type Table struct {
	Header     []string
	Rows       [][]string
	ColWeights []int
}

// Slide is one page of the deck.
type Slide struct {
	Title   string
	Bullets []string
	Table   *Table
	Footer  string
}

// Write serializes the slides as a .pptx package to w.
func Write(w io.Writer, slides []Slide) error {
	if len(slides) == 0 {
		return fmt.Errorf("pptx: no slides")
	}
	zw := zip.NewWriter(w)
	parts := []struct {
		name string
		body string
	}{
		{"[Content_Types].xml", contentTypes(len(slides))},
		{"_rels/.rels", rootRels},
		{"ppt/presentation.xml", presentationXML(len(slides))},
		{"ppt/_rels/presentation.xml.rels", presentationRels(len(slides))},
		{"ppt/slideMasters/slideMaster1.xml", slideMasterXML},
		{"ppt/slideMasters/_rels/slideMaster1.xml.rels", slideMasterRels},
		{"ppt/slideLayouts/slideLayout1.xml", slideLayoutXML},
		{"ppt/slideLayouts/_rels/slideLayout1.xml.rels", slideLayoutRels},
		{"ppt/theme/theme1.xml", themeXML},
	}
	for i, s := range slides {
		parts = append(parts,
			struct{ name, body string }{fmt.Sprintf("ppt/slides/slide%d.xml", i+1), slideXML(s)},
			struct{ name, body string }{fmt.Sprintf("ppt/slides/_rels/slide%d.xml.rels", i+1), slideRels},
		)
	}
	for _, p := range parts {
		f, err := zw.Create(p.name)
		if err != nil {
			return err
		}
		if _, err := io.WriteString(f, p.body); err != nil {
			return err
		}
	}
	return zw.Close()
}

// Bytes is a convenience wrapper returning the package in memory.
func Bytes(slides []Slide) ([]byte, error) {
	var buf bytes.Buffer
	if err := Write(&buf, slides); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

const xmlHeader = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n"

const nsDecl = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
	`xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
	`xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`

const relNS = `http://schemas.openxmlformats.org/officeDocument/2006/relationships`

func contentTypes(n int) string {
	var b strings.Builder
	b.WriteString(xmlHeader)
	b.WriteString(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`)
	b.WriteString(`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`)
	b.WriteString(`<Default Extension="xml" ContentType="application/xml"/>`)
	b.WriteString(`<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`)
	b.WriteString(`<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`)
	b.WriteString(`<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`)
	b.WriteString(`<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`)
	for i := 1; i <= n; i++ {
		fmt.Fprintf(&b, `<Override PartName="/ppt/slides/slide%d.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`, i)
	}
	b.WriteString(`</Types>`)
	return b.String()
}

const rootRels = xmlHeader +
	`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
	`<Relationship Id="rId1" Type="` + relNS + `/officeDocument" Target="ppt/presentation.xml"/>` +
	`</Relationships>`

func presentationXML(n int) string {
	var b strings.Builder
	b.WriteString(xmlHeader)
	fmt.Fprintf(&b, `<p:presentation %s saveSubsetFonts="1">`, nsDecl)
	b.WriteString(`<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>`)
	b.WriteString(`<p:sldIdLst>`)
	for i := 1; i <= n; i++ {
		fmt.Fprintf(&b, `<p:sldId id="%d" r:id="rId%d"/>`, 255+i, i+2)
	}
	b.WriteString(`</p:sldIdLst>`)
	fmt.Fprintf(&b, `<p:sldSz cx="%d" cy="%d"/><p:notesSz cx="6858000" cy="9144000"/>`, slideCX, slideCY)
	b.WriteString(`</p:presentation>`)
	return b.String()
}

func presentationRels(n int) string {
	var b strings.Builder
	b.WriteString(xmlHeader)
	b.WriteString(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`)
	fmt.Fprintf(&b, `<Relationship Id="rId1" Type="%s/slideMaster" Target="slideMasters/slideMaster1.xml"/>`, relNS)
	fmt.Fprintf(&b, `<Relationship Id="rId2" Type="%s/theme" Target="theme/theme1.xml"/>`, relNS)
	for i := 1; i <= n; i++ {
		fmt.Fprintf(&b, `<Relationship Id="rId%d" Type="%s/slide" Target="slides/slide%d.xml"/>`, i+2, relNS, i)
	}
	b.WriteString(`</Relationships>`)
	return b.String()
}

const slideMasterXML = xmlHeader +
	`<p:sldMaster ` + nsDecl + `><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>` +
	`<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
	`<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>` +
	`</p:cSld>` +
	`<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
	`<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
	`</p:sldMaster>`

const slideMasterRels = xmlHeader +
	`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
	`<Relationship Id="rId1" Type="` + relNS + `/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
	`<Relationship Id="rId2" Type="` + relNS + `/theme" Target="../theme/theme1.xml"/>` +
	`</Relationships>`

const slideLayoutXML = xmlHeader +
	`<p:sldLayout ` + nsDecl + ` type="blank" preserve="1"><p:cSld name="Vuoto"><p:spTree>` +
	`<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
	`<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
	`</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`

const slideLayoutRels = xmlHeader +
	`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
	`<Relationship Id="rId1" Type="` + relNS + `/slideMaster" Target="../slideMasters/slideMaster1.xml"/>` +
	`</Relationships>`

const slideRels = xmlHeader +
	`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
	`<Relationship Id="rId1" Type="` + relNS + `/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
	`</Relationships>`

const themeXML = xmlHeader +
	`<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="SWIFT ISO Analyser">` +
	`<a:themeElements>` +
	`<a:clrScheme name="SWIFT ISO">` +
	`<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>` +
	`<a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>` +
	`<a:accent1><a:srgbClr val="1F3864"/></a:accent1><a:accent2><a:srgbClr val="2E75B6"/></a:accent2>` +
	`<a:accent3><a:srgbClr val="70AD47"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>` +
	`<a:accent5><a:srgbClr val="C00000"/></a:accent5><a:accent6><a:srgbClr val="7F7F7F"/></a:accent6>` +
	`<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>` +
	`</a:clrScheme>` +
	`<a:fontScheme name="SWIFT ISO">` +
	`<a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
	`<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>` +
	`</a:fontScheme>` +
	`<a:fmtScheme name="SWIFT ISO">` +
	`<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>` +
	`<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>` +
	`<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
	`<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>` +
	`</a:fmtScheme>` +
	`</a:themeElements></a:theme>`

// esc escapes text for XML and strips characters XML 1.0 does not allow.
func esc(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == '\t' || r == '\n' || r == '\r', r >= 0x20 && r <= 0xD7FF, r >= 0xE000 && r <= 0xFFFD, r >= 0x10000 && r <= 0x10FFFF:
			b.WriteRune(r)
		}
	}
	out := b.String()
	out = strings.ReplaceAll(out, "&", "&amp;")
	out = strings.ReplaceAll(out, "<", "&lt;")
	out = strings.ReplaceAll(out, ">", "&gt;")
	out = strings.ReplaceAll(out, `"`, "&quot;")
	return out
}

type shapeIDs struct{ next int }

func (s *shapeIDs) id() int { s.next++; return s.next }

func xfrm(x, y, cx, cy int) string {
	return fmt.Sprintf(`<a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm>`, x, y, cx, cy)
}

func textBox(ids *shapeIDs, x, y, cx, cy int, paras string) string {
	id := ids.id()
	return fmt.Sprintf(
		`<p:sp><p:nvSpPr><p:cNvPr id="%d" name="Testo %d"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`+
			`<p:spPr>%s<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`+
			`<p:txBody><a:bodyPr wrap="square" lIns="91440" rIns="91440" anchor="t"><a:normAutofit/></a:bodyPr><a:lstStyle/>%s</p:txBody></p:sp>`,
		id, id, xfrm(x, y, cx, cy), paras)
}

func titlePara(text string) string {
	return fmt.Sprintf(`<a:p><a:r><a:rPr lang="it-IT" sz="2800" b="1" dirty="0"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill></a:rPr><a:t>%s</a:t></a:r></a:p>`, esc(text))
}

func bulletPara(text string) string {
	return fmt.Sprintf(`<a:p><a:pPr marL="285750" indent="-285750"><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/></a:pPr>`+
		`<a:r><a:rPr lang="it-IT" sz="1600" dirty="0"/><a:t>%s</a:t></a:r></a:p>`, esc(text))
}

func footerPara(text string) string {
	return fmt.Sprintf(`<a:p><a:r><a:rPr lang="it-IT" sz="1000"><a:solidFill><a:srgbClr val="7F7F7F"/></a:solidFill></a:rPr><a:t>%s</a:t></a:r></a:p>`, esc(text))
}

const cellHeight = 340000

func tableFrame(ids *shapeIDs, t *Table, x, y int) string {
	weights := t.ColWeights
	ncols := len(t.Header)
	if ncols == 0 && len(t.Rows) > 0 {
		ncols = len(t.Rows[0])
	}
	if ncols == 0 {
		return ""
	}
	if len(weights) != ncols {
		weights = make([]int, ncols)
		for i := range weights {
			weights[i] = 1
		}
	}
	total := 0
	for _, w := range weights {
		total += w
	}
	var grid strings.Builder
	colW := make([]int, ncols)
	used := 0
	for i, w := range weights {
		colW[i] = contentW * w / total
		used += colW[i]
	}
	colW[ncols-1] += contentW - used
	for _, w := range colW {
		fmt.Fprintf(&grid, `<a:gridCol w="%d"/>`, w)
	}

	var rows strings.Builder
	writeRow := func(cells []string, header bool) {
		fmt.Fprintf(&rows, `<a:tr h="%d">`, cellHeight)
		for i := 0; i < ncols; i++ {
			text := ""
			if i < len(cells) {
				text = cells[i]
			}
			bold, color, fill := "", "000000", ""
			if header {
				bold = ` b="1"`
				color = "FFFFFF"
				fill = `<a:solidFill><a:srgbClr val="1F3864"/></a:solidFill>`
			}
			fmt.Fprintf(&rows,
				`<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="it-IT" sz="1100"%s dirty="0"><a:solidFill><a:srgbClr val="%s"/></a:solidFill></a:rPr><a:t>%s</a:t></a:r></a:p></a:txBody>`+
					`<a:tcPr marL="68580" marR="68580" marT="34290" marB="34290">`+
					`<a:lnB w="6350"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:lnB>%s</a:tcPr></a:tc>`,
				bold, color, esc(text), fill)
		}
		rows.WriteString(`</a:tr>`)
	}
	if len(t.Header) > 0 {
		writeRow(t.Header, true)
	}
	for _, r := range t.Rows {
		writeRow(r, false)
	}
	height := cellHeight * (len(t.Rows) + boolToInt(len(t.Header) > 0))
	tid := ids.id()
	return fmt.Sprintf(
		`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="%d" name="Tabella %d"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>`+
			`<p:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></p:xfrm>`+
			`<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/>`+
			`<a:tblGrid>%s</a:tblGrid>%s</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
		tid, tid, x, y, contentW, height, grid.String(), rows.String())
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func slideXML(s Slide) string {
	ids := &shapeIDs{}
	var shapes strings.Builder
	shapes.WriteString(textBox(ids, margin, 300000, contentW, 800000, titlePara(s.Title)))

	y := 1250000
	if len(s.Bullets) > 0 {
		var paras strings.Builder
		for _, b := range s.Bullets {
			paras.WriteString(bulletPara(b))
		}
		h := 5000000
		if s.Table != nil {
			h = 1800000
		}
		shapes.WriteString(textBox(ids, margin, y, contentW, h, paras.String()))
		y += h + 100000
	}
	if s.Table != nil {
		shapes.WriteString(tableFrame(ids, s.Table, margin, y))
	}
	if s.Footer != "" {
		shapes.WriteString(textBox(ids, margin, slideCY-420000, contentW, 320000, footerPara(s.Footer)))
	}

	return xmlHeader +
		`<p:sld ` + nsDecl + `><p:cSld><p:spTree>` +
		`<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
		`<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
		shapes.String() +
		`</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}
