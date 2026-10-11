// Plugin Figma privé Dispatch : remplit un template de CV à partir du JSON
// exporté par Dispatch (bouton « Pour Figma »). Aucune donnée ne quitte Figma.
//
// Convention de nommage des calques (voir README.md) :
//   #name #title #summary #skills #languages #formations
//   #label.summary #label.experience #label.skills #label.education #label.languages
//   #exp           cadre répété pour chaque expérience, contenant :
//     #exp.title #exp.company #exp.dates #exp.contract
//     #exp.bullets (un texte, une ligne par bullet) OU #bullet (cadre ou texte répété par bullet,
//     avec un texte #bullet.text s'il s'agit d'un cadre)

function isText(node) { return node && node.type === "TEXT"; }
function canHaveChildren(node) { return node && "children" in node; }

function findAllNamed(roots, predicate) {
  const out = [];
  for (const root of roots) {
    if (predicate(root)) out.push(root);
    if (canHaveChildren(root) && root.findAll) out.push(...root.findAll(predicate));
  }
  return out;
}

// Le premier descendant portant ce nom, sans entrer dans un sous-bloc répété.
function findChild(container, name) {
  if (!canHaveChildren(container)) return null;
  for (const child of container.children) {
    if (child.name === name) return child;
    if (child.name === "#exp" || child.name === "#bullet") continue;
    const deeper = findChild(child, name);
    if (deeper) return deeper;
  }
  return null;
}

async function loadFontsFor(node) {
  if (node.fontName === figma.mixed) {
    const segments = node.getStyledTextSegments(["fontName"]);
    for (const seg of segments) await figma.loadFontAsync(seg.fontName);
  } else {
    await figma.loadFontAsync(node.fontName);
  }
}

async function setText(node, value, report, label) {
  if (!isText(node)) { report.missing.push(label + " (pas un calque texte)"); return; }
  if (node.hasMissingFont) { report.notes.push(label + " : police manquante dans ce fichier"); return; }
  await loadFontsFor(node);
  node.characters = value == null ? "" : String(value);
  report.filled += 1;
}

async function fillOptional(roots, name, value, report) {
  const nodes = findAllNamed(roots, n => n.name === name);
  for (const node of nodes) await setText(node, value, report, name);
  return nodes.length;
}

// Duplique un bloc modèle pour obtenir `count` exemplaires (le modèle compte pour 1).
function repeatBlock(template, count) {
  const parent = template.parent;
  const blocks = [template];
  let index = parent.children.indexOf(template);
  for (let i = 1; i < count; i++) {
    const copy = template.clone();
    index += 1;
    parent.insertChild(index, copy);
    blocks.push(copy);
  }
  template.visible = count > 0;
  return blocks;
}

async function fillBullets(block, bullets, report) {
  const joined = findChild(block, "#exp.bullets");
  if (joined) { await setText(joined, bullets.map(b => "• " + b).join("\n"), report, "#exp.bullets"); return; }
  const tpl = findChild(block, "#bullet");
  if (!tpl) { report.missing.push("#exp.bullets ou #bullet"); return; }
  const items = repeatBlock(tpl, Math.max(bullets.length, 0));
  for (let i = 0; i < bullets.length; i++) {
    const target = isText(items[i]) ? items[i] : findChild(items[i], "#bullet.text");
    if (target) await setText(target, bullets[i], report, "#bullet.text");
    else report.missing.push("#bullet.text");
  }
}

async function fillTemplate(payload, roots) {
  const report = { filled: 0, missing: [], notes: [] };
  if (!payload || payload.version !== 1) throw new Error("Format inconnu : recopie le JSON depuis Dispatch (bouton « Pour Figma »).");
  const simple = {
    "#name": payload.name,
    "#title": payload.title,
    "#summary": payload.summary,
    "#skills": (payload.skills || []).join(" · "),
    "#languages": (payload.languages || []).map(l => l.level ? l.name + " (" + l.level + ")" : l.name).join(" · "),
    "#formations": (payload.formations || []).map(f => f.degree + " — " + f.school + (f.year ? " (" + f.year + ")" : "")).join("\n"),
  };
  for (const key of Object.keys(payload.labels || {})) simple["#label." + key] = payload.labels[key];
  for (const name of Object.keys(simple)) {
    const found = await fillOptional(roots, name, simple[name], report);
    if (!found && ["#name", "#title", "#summary"].indexOf(name) >= 0) report.missing.push(name);
  }

  const templates = findAllNamed(roots, n => n.name === "#exp");
  if (templates.length === 0) {
    report.missing.push("#exp");
  } else {
    const experiences = payload.experiences || [];
    const blocks = repeatBlock(templates[0], experiences.length);
    for (let i = 0; i < experiences.length; i++) {
      const e = experiences[i];
      const block = blocks[i];
      const fields = { "#exp.title": e.title, "#exp.company": e.company, "#exp.dates": e.dates, "#exp.contract": e.contractType };
      for (const name of Object.keys(fields)) {
        const node = findChild(block, name);
        if (node) await setText(node, fields[name], report, name);
        else if (name !== "#exp.contract") report.missing.push(name);
      }
      await fillBullets(block, e.bullets || [], report);
    }
  }
  report.missing = report.missing.filter((m, i, arr) => arr.indexOf(m) === i);
  return report;
}

function describe(report) {
  const lines = [report.filled + " texte(s) rempli(s)."];
  if (report.missing.length) lines.push("Calques introuvables : " + report.missing.join(", "));
  if (report.notes.length) lines.push(report.notes.join("\n"));
  return lines.join("\n");
}

if (typeof figma !== "undefined" && typeof __html__ !== "undefined") {
  figma.showUI(__html__, { width: 360, height: 400 });
  figma.ui.onmessage = async (msg) => {
    if (!msg || msg.type !== "fill") return;
    try {
      const roots = msg.selectionOnly && figma.currentPage.selection.length
        ? figma.currentPage.selection
        : [figma.currentPage];
      const report = await fillTemplate(msg.payload, roots);
      figma.ui.postMessage({ type: "report", ok: report.missing.length === 0, text: describe(report) });
      figma.notify("CV rempli : " + report.filled + " texte(s)");
    } catch (e) {
      figma.ui.postMessage({ type: "report", ok: false, text: String(e && e.message ? e.message : e) });
    }
  };
}

if (typeof globalThis !== "undefined" && globalThis.__DISPATCH_TEST__) {
  globalThis.__DISPATCH_TEST__.fillTemplate = fillTemplate;
}
