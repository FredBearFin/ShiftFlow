# Benchmarks

**The benchmark instance files and published numbers from the cited paper have not been obtained or verified. Any claim that ShiftFlow reproduces a published result is forbidden until they are.**

What is here:

- `runner.py` loads an instance, solves it at leeway 0 and at each frontier anchor, and prints employees, understaffed and overstaffed hours, strain and minimum rest.
- `instances/synthetic_*.json` are three small instances made for this repo whose minimum number of lines can be worked out by hand (the working is in each file's `notes`). They are not published instances.
- `published_results.template.json` is an empty template. Fill it only from a primary source you have checked yourself: citation, URL, instance name, the published number of employees, and the date you verified it. The test suite fails if a `source_url` is committed there, so an unchecked citation cannot slip in; remove that guard when you add verified data.

Run: `python backend/benchmarks/runner.py backend/benchmarks/instances/synthetic_flat1.json`
