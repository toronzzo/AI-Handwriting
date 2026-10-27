# Character pack slot (Preyas / Aquos)

**Public repo ships templates only** (`*.template.*`) with clearly fake PLACEHOLDER text.

For personal use on your Mac, copy templates to real filenames (gitignored):

```bash
cp persona.template.json persona.json
cp lore.template.md lore.md
cp examples.template.jsonl examples.jsonl
# then edit privately — never commit Spin Master / Sega IP, anime audio, or episode files
```

The studio loads `persona.json` + `lore.md` + ~8 retrieved lines from `examples.jsonl`, falling back to the templates if the private files are missing.
