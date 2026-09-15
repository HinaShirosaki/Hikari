#!/usr/bin/env python3
"""Generate a realistic Hikari/Enana storage root (TestData7).

Mirrors the on-disk layout the app hydrates from:
  Project/<p>/MEMORY.md + Notebook/<page>/page.json
  Protocol/<p>/protocol.json (+ protocol.index.sqlite for assay/gel/container rows)
  Workflow/<tpl>/template.json + <run>/workflow.json (+ workflow-status.sqlite)
  Samples/samples.json, Assays/, Gels/, SequenceViewer/entries/*.gbk,
  Papers/, KnowledgeBase/, chat_log/, hikari-chemicals.index.sqlite
"""
import json, os, random, shutil, sqlite3, hashlib, math, textwrap
from datetime import datetime, timedelta, timezone

REPO = os.environ.get("HIKARI_REPO", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ROOT = os.path.join(REPO, "TestData7")
SRC = os.path.join(REPO, "TestData3")          # only for .agents/skills copy
RNG = random.Random(20260827)

SCHEMA_STAMP = "2026-08-27T09:40:00.000Z"

# ---------------------------------------------------------------- helpers
def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond//1000:03d}Z"

def dt(y, mo, d, h=9, mi=0, s=0):
    return datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc)

def ms(d):
    return int(d.timestamp() * 1000)

def mkid(d, n=13):
    return f"{ms(d)}-{''.join(RNG.choice('0123456789abcdef') for _ in range(n))}"

def sanitize(value, fallback="item"):
    out = str(value or "").strip()
    for ch in '<>:"/\\|?*':
        out = out.replace(ch, "_")
    out = "_".join(out.split())
    out = out.strip("_")[:180]
    return out or fallback

def folder(name, ident, fallback="item"):
    return f"{sanitize(name, fallback)}__{sanitize(ident, 'id')}"

def wjson(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

def wtext(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)

def wjsonl(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")

def envelope(kind, payload_key, payload):
    return {
        "schema_name": kind,
        "schema_version": "1.0.0",
        "updated_at": SCHEMA_STAMP,
        payload_key: payload,
    }

def rel(path):
    return os.path.relpath(path, ROOT).replace(os.sep, "/")

# ---------------------------------------------------------------- protocols
# step text uses {name} tokens -> expanded into {{ph:<id>}} placeholders
PROTOCOL_DEFS = [
    ("media_2xyt", "Prepare 2xYT Broth, 1 L", "Media & Buffers",
     "Prepare and autoclave 1 L of 2xYT medium for E. coli expression cultures.",
     ["Tryptone", "Yeast extract", "NaCl", "Milli-Q water", "2 L baffled flask", "Autoclave", "pH meter"],
     [("Weigh {mass} tryptone, {mass} yeast extract and {mass} NaCl into a 2 L flask.", None),
      ("Add {volume} Milli-Q water and stir until fully dissolved.", None),
      ("Adjust to pH {value} with 5 M NaOH.", None),
      ("Bring to 1 L final volume, cap with foil and autoclave at 121 C for {time}.", None),
      ("Cool to room temperature and record the lot number and prep date on the bottle.", None)],
     "Problem: Medium turns brown after autoclaving; Possible cause: Glucose carryover or over-long sterilisation cycle; Solution: Autoclave carbohydrate separately and keep the liquid cycle at 20 min\n"
     "Problem: Contamination within 24 h; Possible cause: Flask closure not steam-permeable or cooled uncovered; Solution: Re-autoclave, use a fresh foil cap and cool in the clean bench"),

    ("media_lbagar", "Pour LB-Agar Plates with Antibiotic", "Media & Buffers",
     "Pour selective LB-agar plates and dry them for transformation plating.",
     ["LB agar powder", "Milli-Q water", "Antibiotic stock", "Sterile Petri dishes", "Water bath 55 C"],
     [("Suspend {mass} LB agar in {volume} Milli-Q water and autoclave.", None),
      ("Cool the molten agar to 55 C in a water bath for {time}.", None),
      ("Add {antibiotic} to a final concentration of {concentration} and swirl without foaming.", None),
      ("Pour {volume} per plate, flame off bubbles and let the plates set for 30 min.", None),
      ("Dry the plates lid-ajar in the clean bench for 20 min, then bag and store at 4 C.", None)],
     "Problem: Colonies grow on the no-DNA control plate; Possible cause: Antibiotic added above 55 C and degraded; Solution: Re-pour with fresh antibiotic added at 50-55 C\n"
     "Problem: Plates sweat and colonies smear; Possible cause: Plates poured warm and bagged wet; Solution: Dry lid-ajar for 20 min before bagging"),

    ("comp_cells", "RbCl Chemically Competent E. coli", "Cloning",
     "Prepare high-efficiency RbCl chemically competent cells and validate the batch.",
     ["Overnight culture", "TFB1 buffer", "TFB2 buffer", "Refrigerated centrifuge", "Cryovials", "Dry ice / ethanol bath"],
     [("Inoculate {volume} of pre-warmed medium with {volume} overnight culture and grow at 37 C.", None),
      ("Harvest at OD600 {value} by chilling the flask on ice for 10 min.", None),
      ("Centrifuge at {speed} for {time} at 4 C and discard the supernatant completely.", None),
      ("Resuspend gently in 0.4 volumes ice-cold TFB1 and hold on ice for {time}.", None),
      ("Pellet again, resuspend in 0.04 volumes ice-cold TFB2 and aliquot {volume} per pre-chilled tube.", None),
      ("Snap-freeze in dry ice/ethanol and store at -80 C. Record the transformation efficiency of the batch.", None)],
     "Problem: Efficiency below 1e6 cfu/ug; Possible cause: Cells harvested past OD600 0.5 or warmed during handling; Solution: Harvest at OD600 0.35-0.45 and keep everything on ice\n"
     "Problem: Cells lyse during TFB2 resuspension; Possible cause: Pipetting too vigorously; Solution: Swirl the tube instead of pipetting"),

    ("transform_hs", "Heat-Shock Transformation of Chemically Competent Cells", "Cloning",
     "Transform plasmid or assembly reaction into chemically competent E. coli by heat shock.",
     ["Competent cells", "Plasmid or assembly reaction", "SOC medium", "42 C heat block", "Selective plates"],
     [("Thaw {volume} competent cells on ice for 10 min.", None),
      ("Add {volume} of DNA, flick to mix and incubate on ice for {time}.", None),
      ("Heat shock at 42 C for {time} and return to ice for 2 min.", None),
      ("Add {volume} SOC and recover at 37 C, 250 rpm for {time}.", None),
      ("Plate {volume} onto {antibiotic} plates and incubate overnight at 37 C.", None),
      ("Count colonies the next morning and record the plate photograph in the notebook.", None)],
     "Problem: No colonies on the sample plate; Possible cause: Heat shock too long or antibiotic mismatch; Solution: Keep the shock at 45 s and confirm the resistance marker of the construct\n"
     "Problem: Lawn on the negative control; Possible cause: Plates too old or antibiotic degraded; Solution: Pour fresh plates and re-run with a no-DNA control"),

    ("transform_electro", "E. coli Plasmid Transformation by Electroporation", "Cloning",
     "Electroporate desalted ligation or assembly products into electrocompetent E. coli.",
     ["Electrocompetent cells", "0.1 cm cuvettes", "Electroporator", "SOC medium", "Selective plates"],
     [("Chill {volume} cuvettes and thaw {volume} electrocompetent cells on ice.", None),
      ("Add {volume} desalted DNA, mix by flicking and transfer without bubbles to the cuvette.", None),
      ("Pulse at {value} kV and record the time constant.", None),
      ("Immediately add {volume} SOC and recover at 37 C for {time}.", None),
      ("Plate a 1:10 dilution series onto {antibiotic} plates.", None)],
     "Problem: Arcing during the pulse; Possible cause: Salt carryover from the ligation; Solution: Drop-dialyse or ethanol precipitate the DNA before pulsing\n"
     "Problem: Time constant below 4 ms; Possible cause: Conductive sample or wet cuvette exterior; Solution: Dry the cuvette and reduce DNA volume to 1-2 uL"),

    ("pcr_q5", "High-Fidelity PCR Amplification (Q5)", "Cloning",
     "Amplify a target fragment with a high-fidelity polymerase for cloning.",
     ["Q5 polymerase 2x master mix", "Forward primer 10 uM", "Reverse primer 10 uM", "Template DNA", "Nuclease-free water", "Thermocycler"],
     [("Assemble a {volume} reaction on ice: 1x master mix, {concentration} each primer, {mass} template.", None),
      ("Initial denaturation 98 C for {time}.", None),
      ("Run {value} cycles of 98 C 10 s, {temperature} 20 s, 72 C {time}.", None),
      ("Final extension 72 C for 2 min, then hold at 4 C.", None),
      ("Check {volume} on a 1% agarose gel next to a 1 kb ladder before purification.", None)],
     "Problem: No product; Possible cause: Annealing temperature above the primer binding Tm; Solution: Run a gradient from Ta-6 C to Ta+4 C\n"
     "Problem: Multiple bands; Possible cause: Primer mispriming or too much template; Solution: Raise Ta by 3 C and dilute the template 1:100"),

    ("pcr_colony", "Colony PCR Screen", "Cloning",
     "Screen transformant colonies for the expected insert before miniprep.",
     ["Taq 2x master mix", "Screening primers", "Sterile tips", "96-well PCR plate", "Agarose gel rig"],
     [("Pick {value} single colonies into a numbered grid on a fresh selective plate and into {volume} of the PCR mix.", None),
      ("Lyse at 95 C for {time} before cycling.", None),
      ("Run 30 cycles of 95 C 20 s, {temperature} 20 s, 68 C {time}.", None),
      ("Resolve the whole reaction on a {value}% agarose gel with a 1 kb ladder.", None),
      ("Mark the positive colonies on the grid plate and inoculate starter cultures the same evening.", None)],
     "Problem: All lanes empty including the positive control; Possible cause: Too much cell mass inhibiting Taq; Solution: Touch the colony only briefly and dilute the lysate 1:10\n"
     "Problem: Insert-size band in the no-template lane; Possible cause: Aerosol contamination from the PCR product; Solution: Set up in a clean hood with filter tips"),

    ("dpni_gibson", "DpnI Digest and Gibson Assembly", "Cloning",
     "Remove methylated template and assemble overlapping fragments in a single isothermal reaction.",
     ["DpnI", "Gibson assembly master mix", "Purified PCR fragments", "Thermocycler", "Nuclease-free water"],
     [("Add {volume} DpnI directly to the PCR product and digest at 37 C for {time}.", None),
      ("Column-purify and quantify each fragment, then normalise to {concentration}.", None),
      ("Combine vector and insert at a {value} insert:vector molar ratio in {volume} assembly mix.", None),
      ("Incubate at 50 C for {time}.", None),
      ("Transform {volume} of the assembly and keep the remainder at -20 C.", None)],
     "Problem: Only background colonies; Possible cause: DpnI digest incomplete; Solution: Extend the digest to 2 h and include a vector-only control\n"
     "Problem: Assembly junctions scrambled; Possible cause: Overlaps shorter than 20 bp or repeated; Solution: Redesign overlaps to 25-30 bp with unique sequence"),

    ("miniprep", "Plasmid Miniprep by Spin-Column Alkaline Lysis", "Cloning",
     "Recover sequencing-grade plasmid DNA from a 5 mL overnight culture.",
     ["Miniprep kit", "Overnight culture", "Microcentrifuge", "Elution buffer", "Nanodrop"],
     [("Pellet {volume} of overnight culture at {speed} for 3 min and discard the medium.", None),
      ("Resuspend in {volume} resuspension buffer until no clumps remain.", None),
      ("Lyse for {time} at room temperature, then neutralise and clear by centrifugation.", None),
      ("Bind, wash twice and dry the column for 1 min at full speed.", None),
      ("Elute in {volume} pre-warmed elution buffer and record A260/A280 and yield.", None)],
     "Problem: Low yield; Possible cause: Culture overgrown or low-copy plasmid; Solution: Harvest at 12-16 h and scale the culture to 10 mL\n"
     "Problem: A260/A230 below 1.8; Possible cause: Guanidine carryover; Solution: Repeat the wash step and dry the column longer"),

    ("agarose", "Agarose Gel Electrophoresis of DNA", "Analysis",
     "Resolve DNA fragments on an agarose gel and document the result.",
     ["Agarose", "1x TAE buffer", "DNA stain", "Gel rig", "1 kb ladder", "Gel documentation system"],
     [("Melt {mass} agarose in {volume} 1x TAE to cast a {value}% gel.", None),
      ("Cool to 60 C, add stain, pour and let it set for {time}.", None),
      ("Load {volume} per well with 6x loading dye alongside {volume} of ladder.", None),
      ("Run at {value} V for {time} in 1x TAE.", None),
      ("Image the gel and save the raw TIFF next to the notebook page.", None)],
     "Problem: Smeared bands; Possible cause: Overloaded wells or degraded sample; Solution: Load half the amount and keep samples on ice\n"
     "Problem: Bands run as a wavy front; Possible cause: Gel run too hot; Solution: Lower to 90 V and use fresh buffer"),

    ("sdspage", "SDS-PAGE of Protein Fractions", "Analysis",
     "Resolve protein fractions on a denaturing polyacrylamide gel and stain with Coomassie.",
     ["4-20% gradient gel", "1x MOPS running buffer", "4x LDS sample buffer", "Reducing agent", "Prestained ladder", "Coomassie stain"],
     [("Mix {volume} of each fraction with 4x LDS buffer and reducing agent.", None),
      ("Heat at 95 C for {time} and spin down briefly.", None),
      ("Load {volume} per well next to {volume} of prestained ladder.", None),
      ("Run at {value} V until the dye front reaches the bottom, about {time}.", None),
      ("Stain for 1 h in Coomassie, destain overnight and scan the gel at 600 dpi.", None)],
     "Problem: Smiling bands at the gel edges; Possible cause: Run too fast or uneven buffer level; Solution: Drop to 140 V and top up the inner chamber\n"
     "Problem: Target band missing from the elution; Possible cause: Protein stayed in the insoluble pellet; Solution: Load the pellet fraction as a control"),

    ("periplasmic", "Periplasmic VHH Expression and Osmotic Shock", "Expression",
     "Express a pelB-directed VHH in the periplasm and release it by cold osmotic shock.",
     ["Transformed BL21(DE3)", "2xYT medium", "IPTG", "TES buffer", "Shaking incubator", "Refrigerated centrifuge"],
     [("Inoculate {volume} 2xYT containing {antibiotic} with an overnight starter and grow at 37 C to OD600 {value}.", None),
      ("Cool the flask to {temperature} for 20 min before induction.", None),
      ("Induce with {concentration} IPTG and express for {time} with shaking.", None),
      ("Harvest at {speed} for 15 min at 4 C and record the wet cell mass.", None),
      ("Resuspend the pellet in ice-cold TES, hold on ice for {time}, then add 0.25x TES and shock for a further 45 min.", None),
      ("Clear the periplasmic extract at 20000 g for 20 min and filter through 0.22 um before loading on IMAC.", None)],
     "Problem: Very little protein in the shock fraction; Possible cause: Induction temperature too high, protein retained in inclusion bodies; Solution: Induce at 20 C overnight and confirm with a whole-cell SDS-PAGE\n"
     "Problem: Extract is viscous; Possible cause: Cell lysis releasing genomic DNA; Solution: Shock more gently and add benzonase before clarification"),

    ("iptg", "IPTG-Induced Cytoplasmic Expression in BL21(DE3)", "Expression",
     "Express a T7-driven construct in BL21(DE3) with IPTG induction.",
     ["Transformed BL21(DE3)", "Expression medium", "Antibiotic", "IPTG", "Shaking incubator", "Spectrophotometer"],
     [("Inoculate {volume} of expression medium containing {antibiotic} with {volume} of overnight starter.", None),
      ("Grow at 37 C, 200 rpm until OD600 reaches {value}.", None),
      ("Add IPTG to a final concentration of {concentration}.", None),
      ("Shift to {temperature} and continue shaking for {time}.", None),
      ("Harvest by centrifugation at {speed} for {time} at 4 C.", None),
      ("Record pellet mass and appearance, then freeze at -80 C or lyse immediately.", None)],
     "Problem: Low expression; Possible cause: Induction conditions suboptimal or plasmid loss; Solution: Test 0.1-1.0 mM IPTG and re-streak from a fresh transformant\n"
     "Problem: Protein mostly insoluble; Possible cause: Expression too fast at 37 C; Solution: Induce at 18-20 C overnight"),

    ("ninta", "Ni-NTA IMAC Purification of His-Tagged Protein", "Purification",
     "Capture a His-tagged protein on Ni-NTA resin and elute with an imidazole step.",
     ["Ni-NTA resin", "Lysis buffer", "Wash buffer", "Elution buffer", "Gravity column", "Refrigerated centrifuge"],
     [("Resuspend the cell pellet in {volume} lysis buffer containing {concentration} imidazole.", None),
      ("Lyse by sonication on ice, {time} total with 2 s on / 4 s off.", None),
      ("Clear the lysate at {speed} for 30 min at 4 C and keep a 20 uL load sample.", None),
      ("Bind to {volume} equilibrated Ni-NTA for {time} at 4 C with end-over-end rotation.", None),
      ("Wash with 10 column volumes of wash buffer containing {concentration} imidazole.", None),
      ("Elute in {volume} fractions with {concentration} imidazole and keep every fraction for SDS-PAGE.", None)],
     "Problem: Target protein in the flow-through; Possible cause: Tag occluded or resin overloaded; Solution: Reduce load, extend binding to 2 h and confirm the tag by western blot\n"
     "Problem: Heavy contaminant background; Possible cause: Wash imidazole too low; Solution: Raise the wash step to 40 mM imidazole"),

    ("sec", "Size-Exclusion Chromatography Polishing", "Purification",
     "Polish an IMAC eluate on a preparative SEC column and assess oligomeric state.",
     ["Superdex 75 16/600 column", "SEC buffer", "FPLC system", "0.22 um filters", "Fraction collector"],
     [("Equilibrate the column with {volume} of filtered, degassed SEC buffer.", None),
      ("Concentrate the IMAC eluate to {volume} and clear at 20000 g for 10 min.", None),
      ("Inject and run at {value} mL/min, collecting {volume} fractions.", None),
      ("Pool the fractions across the monomer peak and record the elution volume.", None),
      ("Measure A280, calculate the yield and store aliquots at {temperature}.", None)],
     "Problem: Protein elutes in the void; Possible cause: Aggregation during concentration; Solution: Concentrate more slowly and add 5% glycerol to the buffer\n"
     "Problem: Peak tailing; Possible cause: Column fouled or flow rate too high; Solution: CIP the column and drop to 0.8 mL/min"),

    ("a280", "Protein Quantification by A280 and BCA", "Analysis",
     "Determine protein concentration by absorbance and cross-check with a BCA assay.",
     ["Nanodrop", "BCA kit", "BSA standards", "Plate reader", "96-well clear plate"],
     [("Blank the spectrophotometer with {volume} of the matching buffer.", None),
      ("Measure A280 in triplicate and apply the extinction coefficient {value} M-1 cm-1.", None),
      ("Prepare a BSA standard curve from {concentration} down in two-fold steps.", None),
      ("Incubate the BCA plate at 37 C for {time} and read at 562 nm.", None),
      ("Report both values and flag any discrepancy greater than 20%.", None)],
     "Problem: A280 much higher than BCA; Possible cause: Nucleic acid carryover; Solution: Check A260/A280 and re-purify if the ratio is above 0.8\n"
     "Problem: Standard curve not linear; Possible cause: Standards pipetted from a warm stock; Solution: Prepare fresh standards on ice and re-read"),

    ("flow_block", "Flow Cytometric Receptor Blocking Assay", "Assay",
     "Measure blockade of a receptor-ligand interaction on stable reporter cells by flow cytometry.",
     ["Stable reporter cell line", "Biotinylated ligand", "Streptavidin-APC", "FACS buffer", "96-well V-bottom plate", "Flow cytometer"],
     [("Harvest cells, wash twice in FACS buffer and resuspend at {concentration} cells/mL.", None),
      ("Plate {volume} per well and add the blocker titration in {value} three-fold steps.", None),
      ("Pre-incubate for {time} at 4 C in the dark.", None),
      ("Add biotinylated ligand to {concentration} and incubate a further {time}.", None),
      ("Wash twice, stain with streptavidin-APC for 20 min at 4 C and wash again.", None),
      ("Acquire at least 10000 live singlets per well and export the geometric mean APC per well.", None)],
     "Problem: No signal window between the top and bottom controls; Possible cause: Ligand concentration far above KD; Solution: Titrate the ligand first and use EC80 for the blocking assay\n"
     "Problem: High background in the secondary-only well; Possible cause: Insufficient washing or Fc binding; Solution: Add an Fc block step and wash three times"),

    ("pnp_lipase", "pNP-Butyrate Lipase Activity Assay", "Assay",
     "Measure lipase activity by following p-nitrophenol release at 405 nm.",
     ["p-nitrophenyl butyrate", "Assay buffer pH 7.4", "Acetonitrile", "96-well clear plate", "Plate reader with kinetics"],
     [("Dilute enzyme to {concentration} in assay buffer and keep on ice.", None),
      ("Prepare a {concentration} pNP-butyrate stock in acetonitrile fresh on the day.", None),
      ("Dispense {volume} enzyme per well and pre-warm the plate at 37 C for {time}.", None),
      ("Start the reaction with {volume} substrate and read A405 every 15 s for {time}.", None),
      ("Fit the linear phase and convert to specific activity with an extinction coefficient of 18.5 mM-1 cm-1.", None)],
     "Problem: Rapid non-enzymatic hydrolysis in the blank; Possible cause: Substrate stock old or buffer pH too high; Solution: Make the substrate fresh and confirm the buffer at pH 7.4\n"
     "Problem: Reaction complete before the first read; Possible cause: Enzyme too concentrated; Solution: Dilute 10-fold and repeat"),

    ("tsa", "Thermal Shift Assay (SYPRO Orange)", "Assay",
     "Rank variant thermostability by SYPRO Orange differential scanning fluorimetry.",
     ["SYPRO Orange 5000x", "Protein samples", "qPCR plate and seal", "Real-time PCR instrument"],
     [("Dilute each protein to {concentration} in the assay buffer.", None),
      ("Add SYPRO Orange to a final {value}x and mix without bubbles.", None),
      ("Dispense {volume} per well in triplicate and seal the plate.", None),
      ("Ramp from 25 C to 95 C at {value} C/min recording fluorescence continuously.", None),
      ("Take Tm as the maximum of the first derivative and report the mean of three wells.", None)],
     "Problem: No transition observed; Possible cause: Protein already unfolded or dye quenched by detergent; Solution: Confirm folding by CD and remove detergent from the buffer\n"
     "Problem: High initial fluorescence; Possible cause: Aggregated or hydrophobic sample; Solution: Spin the sample at 20000 g for 10 min and re-run the supernatant"),

    ("ca_titration", "Calcium Titration of a Fluorescent Biosensor", "Assay",
     "Determine the apparent calcium affinity and dynamic range of a cpGFP biosensor.",
     ["Purified biosensor", "EGTA/CaEGTA calibration buffers", "Black 96-well plate", "Plate reader", "Nanopure water"],
     [("Prepare the zero-free-calcium and 39 uM free-calcium buffers and mix to build {value} points.", None),
      ("Dilute the sensor to {concentration} into each calibration buffer.", None),
      ("Equilibrate the plate at {temperature} for {time} in the dark.", None),
      ("Read excitation {value} nm / emission 515 nm with 10 flashes per well.", None),
      ("Fit F/F0 against free calcium with a Hill model and report Kd and dynamic range.", None)],
     "Problem: Dynamic range below 2; Possible cause: Sensor partly proteolysed at the linker; Solution: Add protease inhibitors during purification and check by SDS-PAGE\n"
     "Problem: Drifting baseline; Possible cause: Plate not thermally equilibrated; Solution: Pre-warm the plate for 15 min before reading"),

    ("hek_passage", "Passaging Adherent HEK 293T Cells", "Cell Culture",
     "Split an adherent HEK 293T monolayer at 80% confluence.",
     ["DMEM + 10% FBS", "0.25% Trypsin-EDTA", "DPBS", "T75 flask", "Class II cabinet", "37 C CO2 incubator"],
     [("Aspirate the medium and rinse the monolayer with {volume} DPBS.", None),
      ("Add {volume} trypsin-EDTA and incubate at 37 C for {time}.", None),
      ("Neutralise with {volume} complete medium and pipette gently to a single-cell suspension.", None),
      ("Seed a new flask at a {value} split ratio in {volume} pre-warmed medium.", None),
      ("Record the passage number and confluence in the culture log.", None)],
     "Problem: Cells detach as sheets; Possible cause: Over-confluent monolayer; Solution: Split at 70-80% and rinse twice with DPBS\n"
     "Problem: Slow recovery after splitting; Possible cause: Trypsin exposure too long; Solution: Limit trypsinisation to 2-3 min and neutralise immediately"),

    ("mycoplasma", "Monthly Mycoplasma Screen by PCR", "Cell Culture",
     "Screen all active cell lines for mycoplasma contamination once per month.",
     ["Mycoplasma detection kit", "Spent culture supernatant", "Positive control DNA", "Thermocycler", "Agarose gel rig"],
     [("Collect {volume} spent supernatant from each line at >70% confluence without antibiotics for {time}.", None),
      ("Heat the supernatant at 95 C for {time} and spin down the debris.", None),
      ("Set up the detection PCR with {volume} of cleared supernatant per reaction.", None),
      ("Run the supplied cycling programme with positive and no-template controls.", None),
      ("Resolve on a 1.5% agarose gel and archive the image with the date and line names.", None)],
     "Problem: Positive control fails; Possible cause: Master mix freeze-thawed too often; Solution: Aliquot the mix and use a fresh tube\n"
     "Problem: Faint band in a test line; Possible cause: Early low-level contamination; Solution: Quarantine the line, repeat from a fresh vial and discard if confirmed"),
]

VALUE_POOL = {
    "volume": ["10 mL", "50 uL", "1 mL", "500 uL", "5 mL", "25 mL", "2 uL", "200 uL", "1.5 mL", "100 uL"],
    "mass": ["16 g", "10 g", "5 g", "35 g", "50 ng", "1 ug"],
    "value": ["0.6", "30", "120", "1.0", "1.5", "3:1", "1:8", "12", "11", "0.05"],
    "time": ["20 min", "45 s", "1 h", "30 min", "16 h", "90 s", "2 h", "15 min", "5 min"],
    "temperature": ["18 C", "20 C", "4 C", "37 C", "60 C", "-80 C", "58 C", "64 C"],
    "concentration": ["0.5 mM", "100 ug/mL", "50 ug/mL", "20 mM", "250 mM", "10 uM", "0.2 mg/mL", "2 mM"],
    "antibiotic": ["kanamycin 50 ug/mL", "ampicillin 100 ug/mL", "chloramphenicol 34 ug/mL"],
    "speed": ["4000 g", "13000 g", "20000 g", "6000 g"],
}

PLACEHOLDER_RE = None

def build_protocols():
    """Expand PROTOCOL_DEFS into app-shaped protocol records keyed by short key."""
    import re
    out = {}
    base = dt(2026, 5, 18, 10, 0)
    for offset, (key, name, category, purpose, materials, steps, trouble) in enumerate(PROTOCOL_DEFS):
        created = base + timedelta(days=offset // 3, hours=(offset % 3) * 2)
        pid = mkid(created)
        step_records = []
        for step_index, (text, _) in enumerate(steps):
            placeholders = []
            def swap(match):
                ph_id = f"{ms(created)}-{''.join(RNG.choice('0123456789abcdef') for _ in range(12))}"
                placeholders.append({"id": ph_id, "name": match.group(1)})
                return "{{ph:%s}}" % ph_id
            rendered = re.sub(r"\{([a-z_]+)\}", swap, text)
            step_records.append({
                "id": f"{ms(created)}-{''.join(RNG.choice('0123456789abcdef') for _ in range(13))}",
                "text": rendered,
                "placeholders": placeholders,
            })
        out[key] = {
            "id": pid,
            "name": name,
            "category": category,
            "createdAt": iso(created),
            "updatedAt": iso(created + timedelta(days=RNG.randint(0, 20))),
            "purpose": purpose,
            "materials": materials,
            "steps": step_records,
            "troubleshooting": trouble,
            "tags": [category, "bench"],
            "linkedProject": "",
            "selectionInsights": [],
        }
    return out

PROTOCOLS = build_protocols()

def protocol_values(protocol, overrides=None):
    """Build the notebook `values` map ({stepId}:{placeholderId} -> text)."""
    overrides = overrides or {}
    values = {}
    counters = {}
    for step in protocol["steps"]:
        for ph in step["placeholders"]:
            name = ph["name"]
            index = counters.get(name, 0)
            counters[name] = index + 1
            pool = VALUE_POOL.get(name, ["n/a"])
            key = f"{name}#{index}"
            values[f"{step['id']}:{ph['id']}"] = overrides.get(key, pool[index % len(pool)])
    return values

def protocol_snapshot(protocol):
    return {
        "id": protocol["id"],
        "name": protocol["name"],
        "category": protocol["category"],
        "purpose": protocol["purpose"],
        "steps": [{"id": s["id"], "text": s["text"], "placeholders": s["placeholders"]} for s in protocol["steps"]],
    }

# ---------------------------------------------------------------- chemicals
# (name, CAS, vendor, catalog, unit size, price, location)
CHEMICALS_RAW = [
    ("Tris base", "77-86-1", "Sigma-Aldrich", "T1503", "1 kg", "148.00", "Shelf A1"),
    ("Tris-HCl", "1185-53-1", "Sigma-Aldrich", "T3253", "500 g", "132.00", "Shelf A1"),
    ("Sodium chloride", "7647-14-5", "Fisher Scientific", "S271-3", "3 kg", "62.40", "Shelf A1"),
    ("Potassium chloride", "7447-40-7", "Fisher Scientific", "P217-500", "500 g", "48.10", "Shelf A1"),
    ("Sodium phosphate dibasic", "7558-79-4", "Sigma-Aldrich", "S9763", "1 kg", "119.00", "Shelf A2"),
    ("Sodium phosphate monobasic", "7558-80-7", "Sigma-Aldrich", "S8282", "500 g", "97.00", "Shelf A2"),
    ("Potassium phosphate dibasic", "7758-11-4", "Sigma-Aldrich", "P3786", "500 g", "88.00", "Shelf A2"),
    ("HEPES", "7365-45-9", "Sigma-Aldrich", "H3375", "500 g", "212.00", "Shelf A2"),
    ("MES hydrate", "1266615-59-1", "Sigma-Aldrich", "M8250", "250 g", "168.00", "Shelf A2"),
    ("MOPS", "1132-61-2", "Sigma-Aldrich", "M1254", "250 g", "154.00", "Shelf A2"),
    ("Glycine", "56-40-6", "Fisher Scientific", "BP381-1", "1 kg", "79.00", "Shelf A3"),
    ("Imidazole", "288-32-4", "Sigma-Aldrich", "I2399", "500 g", "138.00", "Shelf A3"),
    ("EDTA disodium salt", "6381-92-6", "Sigma-Aldrich", "E5134", "500 g", "92.00", "Shelf A3"),
    ("EGTA", "67-42-5", "Sigma-Aldrich", "E3889", "100 g", "186.00", "Shelf A3"),
    ("Glycerol", "56-81-5", "Fisher Scientific", "G33-4", "4 L", "88.00", "Shelf B1"),
    ("Sucrose", "57-50-1", "Sigma-Aldrich", "S0389", "1 kg", "96.00", "Shelf B1"),
    ("D-(+)-Glucose", "50-99-7", "Sigma-Aldrich", "G8270", "1 kg", "84.00", "Shelf B1"),
    ("Glycerol, molecular biology grade", "56-81-5", "Sigma-Aldrich", "G5516", "1 L", "74.00", "Shelf B1"),
    ("Urea", "57-13-6", "Sigma-Aldrich", "U5378", "1 kg", "68.00", "Shelf B2"),
    ("Guanidine hydrochloride", "50-01-1", "Sigma-Aldrich", "G3272", "500 g", "144.00", "Shelf B2"),
    ("Ammonium sulfate", "7783-20-2", "Sigma-Aldrich", "A4418", "1 kg", "72.00", "Shelf B2"),
    ("Ammonium persulfate", "7727-54-0", "Bio-Rad", "1610700", "50 g", "56.00", "Shelf B2"),
    ("TEMED", "110-18-9", "Bio-Rad", "1610800", "50 mL", "68.00", "Flammables Cabinet B2"),
    ("Acrylamide/Bis 30% 37.5:1", "79-06-1", "Bio-Rad", "1610158", "500 mL", "128.00", "Fridge 4C"),
    ("SDS", "151-21-3", "Sigma-Aldrich", "L3771", "500 g", "158.00", "Shelf B3"),
    ("Sodium deoxycholate", "302-95-4", "Sigma-Aldrich", "D6750", "100 g", "112.00", "Shelf B3"),
    ("Triton X-100", "9036-19-5", "Sigma-Aldrich", "X100", "500 mL", "86.00", "Shelf B3"),
    ("Tween 20", "9005-64-5", "Sigma-Aldrich", "P1379", "500 mL", "78.00", "Shelf B3"),
    ("n-Dodecyl-beta-D-maltoside", "69227-93-6", "Anatrace", "D310", "5 g", "348.00", "Fridge 4C"),
    ("DTT", "3483-12-3", "Thermo Scientific", "R0861", "25 g", "182.00", "Freezer -20"),
    ("TCEP hydrochloride", "51805-45-9", "Thermo Scientific", "20490", "5 g", "196.00", "Freezer -20"),
    ("2-Mercaptoethanol", "60-24-2", "Sigma-Aldrich", "M6250", "100 mL", "64.00", "Flammables Cabinet B2"),
    ("Iodoacetamide", "144-48-9", "Sigma-Aldrich", "I1149", "25 g", "124.00", "Freezer -20"),
    ("IPTG", "367-93-1", "Gold Biotechnology", "I2481C", "25 g", "132.00", "Freezer -20"),
    ("X-Gal", "7240-90-6", "Gold Biotechnology", "X4281C", "1 g", "92.00", "Freezer -20"),
    ("L-Arabinose", "5328-37-0", "Sigma-Aldrich", "A3256", "100 g", "138.00", "Shelf B1"),
    ("Ampicillin sodium salt", "69-52-3", "Gold Biotechnology", "A-301-25", "25 g", "78.00", "Freezer -20"),
    ("Kanamycin sulfate", "25389-94-0", "Gold Biotechnology", "K-120-25", "25 g", "96.00", "Freezer -20"),
    ("Chloramphenicol", "56-75-7", "Sigma-Aldrich", "C0378", "25 g", "88.00", "Freezer -20"),
    ("Carbenicillin disodium", "4800-94-6", "Gold Biotechnology", "C-103-5", "5 g", "104.00", "Freezer -20"),
    ("Spectinomycin dihydrochloride", "22189-32-8", "Gold Biotechnology", "S-140-5", "5 g", "118.00", "Freezer -20"),
    ("Tetracycline hydrochloride", "64-75-5", "Sigma-Aldrich", "T7660", "25 g", "94.00", "Freezer -20"),
    ("Tryptone", "91079-40-2", "BD Difco", "211705", "500 g", "112.00", "Shelf C1"),
    ("Yeast extract", "8013-01-2", "BD Difco", "212750", "500 g", "126.00", "Shelf C1"),
    ("LB Broth (Miller)", "-", "Fisher Scientific", "BP1426-2", "2 kg", "168.00", "Shelf C1"),
    ("LB Agar (Miller)", "-", "Fisher Scientific", "BP1425-2", "2 kg", "184.00", "Shelf C1"),
    ("Terrific Broth", "-", "Fisher Scientific", "BP2468-2", "2 kg", "192.00", "Shelf C1"),
    ("Agar, bacteriological", "9002-18-0", "Sigma-Aldrich", "A5306", "1 kg", "212.00", "Shelf C1"),
    ("Glycine betaine", "107-43-7", "Sigma-Aldrich", "B3501", "25 g", "88.00", "Shelf C2"),
    ("Sorbitol", "50-70-4", "Sigma-Aldrich", "S1876", "500 g", "94.00", "Shelf C2"),
    ("Rubidium chloride", "7791-11-9", "Sigma-Aldrich", "R2252", "25 g", "162.00", "Shelf C2"),
    ("Manganese(II) chloride tetrahydrate", "13446-34-9", "Sigma-Aldrich", "M8054", "100 g", "78.00", "Shelf C2"),
    ("Calcium chloride dihydrate", "10035-04-8", "Sigma-Aldrich", "C3306", "500 g", "82.00", "Shelf C2"),
    ("Magnesium chloride hexahydrate", "7791-18-6", "Sigma-Aldrich", "M2670", "1 kg", "88.00", "Shelf C2"),
    ("Magnesium sulfate heptahydrate", "10034-99-8", "Sigma-Aldrich", "M1880", "1 kg", "74.00", "Shelf C2"),
    ("Zinc sulfate heptahydrate", "7446-20-0", "Sigma-Aldrich", "Z0251", "500 g", "68.00", "Shelf C3"),
    ("Nickel(II) sulfate hexahydrate", "10101-97-0", "Sigma-Aldrich", "227676", "500 g", "96.00", "Shelf C3"),
    ("Cobalt(II) chloride hexahydrate", "7791-13-1", "Sigma-Aldrich", "255599", "100 g", "84.00", "Shelf C3"),
    ("Copper(II) sulfate pentahydrate", "7758-99-8", "Sigma-Aldrich", "C8027", "500 g", "72.00", "Shelf C3"),
    ("Iron(III) chloride hexahydrate", "10025-77-1", "Sigma-Aldrich", "236489", "500 g", "78.00", "Shelf C3"),
    ("Hydrochloric acid 37%", "7647-01-0", "Fisher Scientific", "A144-212", "2.5 L", "68.00", "Acid Cabinet C1"),
    ("Sulfuric acid 98%", "7664-93-9", "Fisher Scientific", "A300-212", "2.5 L", "74.00", "Acid Cabinet C1"),
    ("Nitric acid 70%", "7697-37-2", "Fisher Scientific", "A200-212", "2.5 L", "82.00", "Acid Cabinet C1"),
    ("Acetic acid, glacial", "64-19-7", "Fisher Scientific", "A38-212", "2.5 L", "58.00", "Acid Cabinet C1"),
    ("Formic acid 98%", "64-18-6", "Sigma-Aldrich", "F0507", "1 L", "96.00", "Acid Cabinet C1"),
    ("Trifluoroacetic acid", "76-05-1", "Sigma-Aldrich", "302031", "100 mL", "142.00", "Acid Cabinet C1"),
    ("Phosphoric acid 85%", "7664-38-2", "Sigma-Aldrich", "345245", "1 L", "78.00", "Acid Cabinet C1"),
    ("Sodium hydroxide pellets", "1310-73-2", "Fisher Scientific", "S318-1", "1 kg", "56.00", "Shelf D1"),
    ("Potassium hydroxide", "1310-58-3", "Sigma-Aldrich", "221473", "500 g", "62.00", "Shelf D1"),
    ("Ammonium bicarbonate", "1066-33-7", "Sigma-Aldrich", "A6141", "500 g", "68.00", "Shelf D1"),
    ("Sodium bicarbonate", "144-55-8", "Fisher Scientific", "S233-500", "500 g", "44.00", "Shelf D1"),
    ("Methanol", "67-56-1", "Fisher Scientific", "A412-4", "4 L", "72.00", "Flammables Cabinet B2"),
    ("Ethanol, absolute", "64-17-5", "Decon Labs", "2716", "4 L", "68.00", "Flammables Cabinet B2"),
    ("Isopropanol", "67-63-0", "Fisher Scientific", "A416-4", "4 L", "76.00", "Flammables Cabinet B2"),
    ("Acetonitrile, HPLC grade", "75-05-8", "Fisher Scientific", "A998-4", "4 L", "124.00", "Flammables Cabinet B2"),
    ("Acetone", "67-64-1", "Fisher Scientific", "A18-4", "4 L", "64.00", "Flammables Cabinet B2"),
    ("Dimethyl sulfoxide", "67-68-5", "Sigma-Aldrich", "D8418", "1 L", "94.00", "Shelf D2"),
    ("N,N-Dimethylformamide", "68-12-2", "Sigma-Aldrich", "227056", "1 L", "88.00", "Flammables Cabinet B2"),
    ("Chloroform", "67-66-3", "Fisher Scientific", "C298-500", "500 mL", "72.00", "Flammables Cabinet B2"),
    ("Phenol:Chloroform:IAA 25:24:1", "-", "Thermo Scientific", "17909", "100 mL", "118.00", "Fridge 4C"),
    ("TRIzol reagent", "-", "Thermo Scientific", "15596026", "100 mL", "268.00", "Fridge 4C"),
    ("Agarose, molecular biology grade", "9012-36-6", "Gold Biotechnology", "A-201-500", "500 g", "236.00", "Shelf D3"),
    ("SYBR Safe DNA gel stain", "-", "Thermo Scientific", "S33102", "400 uL", "182.00", "Freezer -20"),
    ("Ethidium bromide 10 mg/mL", "1239-45-8", "Sigma-Aldrich", "E1510", "10 mL", "94.00", "Acid Cabinet C1"),
    ("SYPRO Orange 5000x", "-", "Thermo Scientific", "S6650", "500 uL", "168.00", "Freezer -20"),
    ("Coomassie Brilliant Blue R-250", "6104-59-2", "Bio-Rad", "1610400", "10 g", "68.00", "Shelf D3"),
    ("Bradford reagent", "-", "Bio-Rad", "5000006", "450 mL", "112.00", "Fridge 4C"),
    ("BCA protein assay kit", "-", "Thermo Scientific", "23225", "1 kit", "186.00", "Fridge 4C"),
    ("Bovine serum albumin, fraction V", "9048-46-8", "Sigma-Aldrich", "A7906", "100 g", "168.00", "Fridge 4C"),
    ("p-Nitrophenyl butyrate", "2635-84-9", "Sigma-Aldrich", "N9876", "1 g", "148.00", "Freezer -20"),
    ("p-Nitrophenol", "100-02-7", "Sigma-Aldrich", "1048", "100 g", "92.00", "Shelf D3"),
    ("4-Nitrophenyl phosphate", "4264-83-9", "Sigma-Aldrich", "N4645", "5 g", "196.00", "Freezer -20"),
    ("ATP disodium salt", "34369-07-8", "Sigma-Aldrich", "A26209", "5 g", "228.00", "Freezer -20"),
    ("NADH disodium salt", "606-68-8", "Sigma-Aldrich", "N8129", "1 g", "268.00", "Freezer -20"),
    ("Phenylmethylsulfonyl fluoride", "329-98-6", "Sigma-Aldrich", "P7626", "5 g", "142.00", "Freezer -20"),
    ("cOmplete EDTA-free protease inhibitor", "-", "Roche", "11873580001", "20 tablets", "212.00", "Freezer -20"),
    ("Lysozyme from chicken egg white", "12650-88-3", "Sigma-Aldrich", "L6876", "5 g", "126.00", "Freezer -20"),
    ("DNase I, grade II", "9003-98-9", "Roche", "10104159001", "100 mg", "218.00", "Freezer -20"),
    ("Benzonase nuclease", "9025-65-4", "Sigma-Aldrich", "E1014", "25 kU", "268.00", "Freezer -20"),
    ("Q5 High-Fidelity 2x Master Mix", "-", "New England Biolabs", "M0492L", "500 rxn", "384.00", "Freezer -20"),
    ("Taq 2x Master Mix", "-", "New England Biolabs", "M0270L", "500 rxn", "268.00", "Freezer -20"),
    ("Gibson Assembly Master Mix", "-", "New England Biolabs", "E2611L", "50 rxn", "486.00", "Freezer -20"),
    ("DpnI restriction enzyme", "-", "New England Biolabs", "R0176L", "5000 U", "268.00", "Freezer -20"),
    ("T4 DNA Ligase", "-", "New England Biolabs", "M0202L", "100000 U", "236.00", "Freezer -20"),
    ("NdeI restriction enzyme", "-", "New England Biolabs", "R0111L", "5000 U", "246.00", "Freezer -20"),
    ("XhoI restriction enzyme", "-", "New England Biolabs", "R0146L", "5000 U", "246.00", "Freezer -20"),
    ("BamHI-HF restriction enzyme", "-", "New England Biolabs", "R3136L", "10000 U", "252.00", "Freezer -20"),
    ("dNTP mix 10 mM each", "-", "Thermo Scientific", "R0192", "1 mL", "158.00", "Freezer -20"),
    ("1 kb Plus DNA Ladder", "-", "New England Biolabs", "N3200L", "250 lanes", "182.00", "Freezer -20"),
    ("Precision Plus Protein Dual Color Standard", "-", "Bio-Rad", "1610374", "500 uL", "212.00", "Freezer -20"),
    ("TEV protease, in-house", "-", "In-house", "TEV-2026-03", "5 mg", "0.00", "Freezer -80"),
    ("Ni-NTA Agarose", "-", "Qiagen", "30230", "100 mL", "486.00", "Fridge 4C"),
    ("Streptavidin-APC conjugate", "-", "BioLegend", "405207", "500 ug", "384.00", "Fridge 4C"),
    ("EZ-Link NHS-PEG4-Biotin", "-", "Thermo Scientific", "21330", "100 mg", "268.00", "Freezer -20"),
    ("DMEM, high glucose", "-", "Thermo Scientific", "11965092", "500 mL", "38.00", "Fridge 4C"),
    ("Fetal bovine serum, heat inactivated", "-", "Thermo Scientific", "16140071", "500 mL", "684.00", "Freezer -20"),
    ("Penicillin-Streptomycin 100x", "-", "Thermo Scientific", "15140122", "100 mL", "42.00", "Freezer -20"),
    ("0.25% Trypsin-EDTA", "-", "Thermo Scientific", "25200056", "100 mL", "36.00", "Fridge 4C"),
    ("DPBS, no calcium no magnesium", "-", "Thermo Scientific", "14190144", "500 mL", "24.00", "Room 305"),
    ("Opti-MEM I reduced serum medium", "-", "Thermo Scientific", "31985070", "500 mL", "58.00", "Fridge 4C"),
    ("Polyethylenimine MAX, 40 kDa", "49553-93-7", "Polysciences", "24765-1", "1 g", "168.00", "Freezer -20"),
    ("Puromycin dihydrochloride", "58-58-2", "Gold Biotechnology", "P-600-100", "100 mg", "142.00", "Freezer -20"),
    ("Blasticidin S hydrochloride", "3513-03-9", "Gold Biotechnology", "B-800-25", "25 mg", "218.00", "Freezer -20"),
    ("Trypan blue solution 0.4%", "72-57-1", "Thermo Scientific", "15250061", "100 mL", "32.00", "Room 305"),
    ("Paraformaldehyde 16% EM grade", "30525-89-4", "Electron Microscopy Sciences", "15710", "10 x 10 mL", "112.00", "Fridge 4C"),
    ("Liquid nitrogen", "7727-37-9", "Airgas", "NI230LT", "230 L", "0.00", "Room 210"),
    ("Dry ice pellets", "124-38-9", "Airgas", "DIP10", "10 kg", "0.00", "Room 210"),
]

CHEM_ZONES = ["Room Temp", "4 Degree", "-20 Degree", "-80 Degree", "Liquid Nitrogen"]

# ---------------------------------------------------------------- containers
CONTAINER_DEFS = [
    ("Room Temp", "Plasmid Stock Box RT-1", "box81", dt(2026, 5, 20, 11, 12)),
    ("Room Temp", "Primer Plate 2026-Q2", "plate96", dt(2026, 5, 20, 11, 30)),
    ("4 Degree", "Purified Protein Rack 4C", "box81", dt(2026, 5, 21, 9, 5)),
    ("4 Degree", "Working Buffers Shelf", "box25", dt(2026, 5, 21, 9, 25)),
    ("-20 Degree", "Enzymes and Oligos Box", "box81", dt(2026, 5, 22, 14, 2)),
    ("-20 Degree", "Miniprep Archive Box", "box100", dt(2026, 5, 22, 14, 40)),
    ("-80 Degree", "Glycerol Stocks 2026", "box81", dt(2026, 5, 23, 16, 18)),
    ("-80 Degree", "Purified VHH Aliquots", "box81", dt(2026, 5, 23, 16, 45)),
    ("Liquid Nitrogen", "HEK293T Cell Bank", "box25", dt(2026, 5, 24, 10, 3)),
]

CONTAINER_WELLS = {"box25": 25, "box49": 49, "box64": 64, "box81": 81, "box100": 100, "plate96": 96, "single": 0}

# (container name, code, name, type, lot, concentration, notes)
SAMPLE_DEFS = [
    ("Plasmid Stock Box RT-1", "PL-001", "pET28a-His6-TEV-VHH_CD47_C11", "plasmid", "MP-260604", "212 ng/uL", "Sequence verified 2026-06-05, clone C11"),
    ("Plasmid Stock Box RT-1", "PL-002", "pET28a-His6-TEV-VHH_CD47_D4", "plasmid", "MP-260604", "188 ng/uL", "Sequence verified 2026-06-05, clone D4"),
    ("Plasmid Stock Box RT-1", "PL-003", "pHEN6c-VHH_CD47_C11-HA-His6", "plasmid", "MP-260611", "241 ng/uL", "Periplasmic expression vector"),
    ("Plasmid Stock Box RT-1", "PL-004", "pET21a-cpGFP-CaM-M13", "plasmid", "MP-260615", "305 ng/uL", "Parent biosensor construct"),
    ("Plasmid Stock Box RT-1", "PL-005", "pET21a-cpGFP-CaM-M13_T203V", "plasmid", "MP-260702", "276 ng/uL", "Chromophore environment variant"),
    ("Plasmid Stock Box RT-1", "PL-006", "pET21a-cpGFP-CaM-M13_L60Q", "plasmid", "MP-260702", "254 ng/uL", "Linker-1 variant"),
    ("Plasmid Stock Box RT-1", "PL-007", "pBAD33-CalB", "plasmid", "MP-260626", "198 ng/uL", "Wild-type lipase B"),
    ("Plasmid Stock Box RT-1", "PL-008", "pBAD33-CalB_D223G_L278M", "plasmid", "MP-260710", "176 ng/uL", "Round-1 thermostability hit"),
    ("Plasmid Stock Box RT-1", "PL-009", "pET28a-His6-TEV-S219V", "plasmid", "MP-260528", "402 ng/uL", "TEV protease production plasmid"),
    ("Plasmid Stock Box RT-1", "PL-010", "pUC19 cloning intermediate", "plasmid", "MP-260528", "512 ng/uL", "Assembly staging vector"),
    ("Primer Plate 2026-Q2", "OL-101", "VHH_C11_gib_F", "primer", "IDT-8829140", "100 uM", "Gibson overlap into pET28a NdeI site"),
    ("Primer Plate 2026-Q2", "OL-102", "VHH_C11_gib_R", "primer", "IDT-8829141", "100 uM", "Gibson overlap into pET28a XhoI site"),
    ("Primer Plate 2026-Q2", "OL-103", "pET28a_bb_F", "primer", "IDT-8829142", "100 uM", "Backbone amplification forward"),
    ("Primer Plate 2026-Q2", "OL-104", "pET28a_bb_R", "primer", "IDT-8829143", "100 uM", "Backbone amplification reverse"),
    ("Primer Plate 2026-Q2", "OL-105", "T7_promoter_seq", "primer", "IDT-8829144", "10 uM", "Sequencing primer"),
    ("Primer Plate 2026-Q2", "OL-106", "T7_terminator_seq", "primer", "IDT-8829145", "10 uM", "Sequencing primer"),
    ("Primer Plate 2026-Q2", "OL-107", "cpGFP_T203V_QC_F", "primer", "IDT-8834021", "100 uM", "Site-directed mutagenesis forward"),
    ("Primer Plate 2026-Q2", "OL-108", "cpGFP_T203V_QC_R", "primer", "IDT-8834022", "100 uM", "Site-directed mutagenesis reverse"),
    ("Primer Plate 2026-Q2", "OL-109", "CalB_lib_NNK_F", "primer", "IDT-8841077", "100 uM", "NNK library primer, positions 221-225"),
    ("Primer Plate 2026-Q2", "OL-110", "CalB_lib_NNK_R", "primer", "IDT-8841078", "100 uM", "NNK library primer, positions 274-280"),
    ("Primer Plate 2026-Q2", "OL-111", "pBAD_colonyPCR_F", "primer", "IDT-8841079", "10 uM", "Colony screen forward"),
    ("Primer Plate 2026-Q2", "OL-112", "pBAD_colonyPCR_R", "primer", "IDT-8841080", "10 uM", "Colony screen reverse"),
    ("Purified Protein Rack 4C", "PR-201", "VHH_CD47_C11 SEC pool", "protein", "P260618-A", "4.2 mg/mL", "Monomer peak 68-74 mL, 96% pure by SDS-PAGE"),
    ("Purified Protein Rack 4C", "PR-202", "VHH_CD47_D4 SEC pool", "protein", "P260618-B", "2.8 mg/mL", "Slight dimer shoulder, still usable for blocking assay"),
    ("Purified Protein Rack 4C", "PR-203", "cpGFP-CaM-M13 parent", "protein", "P260705-A", "6.1 mg/mL", "Bright green pellet, store dark"),
    ("Purified Protein Rack 4C", "PR-204", "cpGFP-CaM-M13 T203V", "protein", "P260712-A", "5.4 mg/mL", "Dynamic range improved vs parent"),
    ("Purified Protein Rack 4C", "PR-205", "CalB wild type", "protein", "P260701-A", "3.3 mg/mL", "Refolded from periplasmic extract"),
    ("Purified Protein Rack 4C", "PR-206", "CalB D223G/L278M", "protein", "P260718-A", "2.9 mg/mL", "Round-1 variant for TSA"),
    ("Purified Protein Rack 4C", "PR-207", "Biotinylated human CD47 ECD", "protein", "COM-4471", "1.0 mg/mL", "Commercial, 1 biotin per molecule"),
    ("Working Buffers Shelf", "BF-301", "SEC buffer 20 mM HEPES 150 mM NaCl pH 7.4", "buffer", "BUF-260617", "1x", "Filtered and degassed, 1 L"),
    ("Working Buffers Shelf", "BF-302", "IMAC lysis buffer + 20 mM imidazole", "buffer", "BUF-260616", "1x", "Make protease inhibitor addition fresh"),
    ("Working Buffers Shelf", "BF-303", "TES osmotic shock buffer", "buffer", "BUF-260612", "1x", "0.2 M Tris, 0.5 mM EDTA, 0.5 M sucrose"),
    ("Working Buffers Shelf", "BF-304", "FACS buffer, PBS 2% FBS 2 mM EDTA", "buffer", "BUF-260620", "1x", "Keep at 4 C, use within two weeks"),
    ("Enzymes and Oligos Box", "EN-401", "Q5 High-Fidelity 2x Master Mix", "reagent", "10141285", "2x", "NEB M0492L working aliquot"),
    ("Enzymes and Oligos Box", "EN-402", "Gibson Assembly Master Mix", "reagent", "10148812", "2x", "Thaw on ice, single use aliquots"),
    ("Enzymes and Oligos Box", "EN-403", "DpnI 20 U/uL", "reagent", "10151004", "20 U/uL", "NEB R0176L"),
    ("Enzymes and Oligos Box", "EN-404", "TEV protease in-house", "reagent", "TEV-2026-03", "2 mg/mL", "1:20 w/w cleavage overnight at 4 C"),
    ("Miniprep Archive Box", "AR-501", "pET28a-VHH_CD47 panel minipreps", "plasmid", "MP-260604", "mixed", "12 clones from the first panning output"),
    ("Miniprep Archive Box", "AR-502", "cpGFP variant panel minipreps", "plasmid", "MP-260702", "mixed", "Round-1 linker library, 24 clones"),
    ("Miniprep Archive Box", "AR-503", "CalB NNK library minipreps", "plasmid", "MP-260710", "mixed", "Pooled library, titre 4.8e6"),
    ("Glycerol Stocks 2026", "GS-601", "BL21(DE3) pET28a-VHH_CD47_C11", "strain", "GS-260606", "-", "15% glycerol, two vials"),
    ("Glycerol Stocks 2026", "GS-602", "BL21(DE3) pET28a-VHH_CD47_D4", "strain", "GS-260606", "-", "15% glycerol, two vials"),
    ("Glycerol Stocks 2026", "GS-603", "BL21(DE3) pET21a-cpGFP-CaM-M13", "strain", "GS-260616", "-", "Green pellet visible after induction"),
    ("Glycerol Stocks 2026", "GS-604", "TOP10 pBAD33-CalB", "strain", "GS-260627", "-", "Arabinose-inducible expression host"),
    ("Glycerol Stocks 2026", "GS-605", "BL21(DE3) pRARE2 helper", "strain", "GS-260530", "-", "Rare codon supplement, Cm resistant"),
    ("Glycerol Stocks 2026", "GS-606", "DH5alpha cloning host", "strain", "GS-260530", "-", "Chemically competent stock source"),
    ("Purified VHH Aliquots", "AL-701", "VHH_CD47_C11 50 uL aliquots", "protein", "P260618-A", "4.2 mg/mL", "Ten single-use aliquots, snap frozen"),
    ("Purified VHH Aliquots", "AL-702", "VHH_CD47_D4 50 uL aliquots", "protein", "P260618-B", "2.8 mg/mL", "Eight single-use aliquots"),
    ("Purified VHH Aliquots", "AL-703", "cpGFP T203V 100 uL aliquots", "protein", "P260712-A", "5.4 mg/mL", "Protect from light"),
    ("HEK293T Cell Bank", "CL-801", "HEK293T parental P12", "cell_line", "CB-260410", "3e6 cells/vial", "Mycoplasma negative 2026-08-03"),
    ("HEK293T Cell Bank", "CL-802", "HEK293T CD47-high stable pool", "cell_line", "CB-260521", "3e6 cells/vial", "Puromycin selected, used for blocking assay"),
    ("HEK293T Cell Bank", "CL-803", "HEK293T CD47 knockout clone 2F", "cell_line", "CB-260528", "2e6 cells/vial", "Assay negative control line"),
    ("HEK293T Cell Bank", "CL-804", "Jurkat E6-1", "cell_line", "CB-260315", "5e6 cells/vial", "Suspension control line"),
]

def build_inventory():
    """containers (personal inventory) + registered samples."""
    containers = {}
    by_name = {}
    for zone, name, ctype, created in CONTAINER_DEFS:
        cid = mkid(created)
        record = {"id": cid, "name": name, "type": ctype, "wells": [""] * CONTAINER_WELLS[ctype]}
        containers.setdefault(zone, []).append(record)
        by_name[name] = (zone, record)

    samples = []
    used = {}
    for offset, (cname, code, name, stype, lot, conc, notes) in enumerate(SAMPLE_DEFS):
        zone, container = by_name[cname]
        slot = used.get(cname, 0)
        used[cname] = slot + 1
        created = dt(2026, 6, 1, 9, 0) + timedelta(days=offset // 2, minutes=offset * 7)
        if zone == "4 Degree":
            location = {"storageType": "fridge", "fridge": "4 Degree", "shelf": container["name"]}
        elif zone == "Room Temp":
            location = {"storageType": "rt_cabinet", "cabinet": "Room Temp", "slot": container["name"]}
        else:
            well = (f"{chr(65 + slot // 12)}{slot % 12 + 1}" if container["type"] == "plate96"
                    else f"W{slot + 1}")
            location = {"storageType": "freezer", "freezer": zone, "rack": "",
                        "box": container["name"], "position": well}
        samples.append({
            "id": f"sample-{ms(created)}-{''.join(RNG.choice('0123456789abcdef') for _ in range(4))}",
            "code": code,
            "name": name,
            "type": stype,
            "lot": lot,
            "concentration": conc,
            "notes": notes,
            "location": location,
            "inventoryLink": {"section": zone, "containerId": container["id"], "wellIndex": slot},
            "chemicalLinks": [],
            "compoundStructure": None,
            "updatedAt": iso(created),
        })
    return containers, samples

CONTAINERS, SAMPLES = build_inventory()

def build_chemicals():
    chemicals = []
    code_map = {}
    next_by_location = {}
    blocks = []
    last_number = 100000
    prev_hash = "GENESIS"
    stamp = dt(2026, 5, 18, 8, 30)
    for index, (name, cas, vendor, catalog, unit, price, location) in enumerate(CHEMICALS_RAW):
        stamp = stamp + timedelta(minutes=RNG.randint(4, 90))
        key = location.lower()
        if key not in code_map:
            code_map[key] = chr(65 + (len(code_map) % 26))
            next_by_location[key] = 1
        next_by_location[key] += 1
        last_number += RNG.randint(37, 941)
        chem_id = f"{ms(stamp)}-{''.join(RNG.choice('0123456789abcdef') for _ in range(13))}"
        amount = RNG.choice(["", "1 unopened", "2 bottles", "~60% remaining", "3 x 25 g", "1 opened"])
        expiry = "" if RNG.random() < 0.55 else iso(stamp + timedelta(days=RNG.randint(200, 900)))[:10]
        chemicals.append({
            "id": chem_id,
            "name": name,
            "casNumber": cas,
            "location": location,
            "locationNumber": last_number,
            "vendor": vendor,
            "catalogNumber": catalog,
            "unitSize": unit,
            "price": price,
            "amountInStock": amount,
            "url": f"https://www.example-supplier.test/catalog/{catalog.lower()}",
            "expirationDate": expiry,
            "updatedAt": iso(stamp),
            "amount": amount,
            "cas": cas,
            "supplier": vendor,
            "locationCode": f"{code_map[key]}{last_number}",
        })
        block = {
            "index": index + 1,
            "timestamp": iso(stamp),
            "action": "UPSERT_CHEMICAL",
            "prevHash": prev_hash,
            "payload": {"chemicalId": chem_id, "name": name, "casNumber": cas, "location": location},
        }
        block["hash"] = "h" + hashlib.sha256(
            (prev_hash + json.dumps(block["payload"], sort_keys=True)).encode()
        ).hexdigest()[:8]
        prev_hash = block["hash"]
        blocks.append(block)
    meta = {
        "lab_blocks": blocks,
        "lab_last_location_number": last_number,
        "lab_location_code_map": code_map,
        "lab_location_code_next_by_location": next_by_location,
    }
    return chemicals, meta

CHEMICALS, CHEM_META = build_chemicals()

def write_chemicals_sqlite():
    path = os.path.join(ROOT, "hikari-chemicals.index.sqlite")
    if os.path.exists(path):
        os.remove(path)
    db = sqlite3.connect(path)
    db.executescript("""
      CREATE TABLE inventory_meta (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
      CREATE TABLE inventory_chemicals (
        id TEXT PRIMARY KEY, name TEXT, amount TEXT, cas TEXT, location TEXT,
        supplier TEXT, search_text TEXT, raw_json TEXT);
    """)
    db.executemany("INSERT INTO inventory_meta (key, value_json) VALUES (?, ?)",
                   [(k, json.dumps(v)) for k, v in CHEM_META.items()])
    db.executemany(
        "INSERT INTO inventory_chemicals (id, name, amount, cas, location, supplier, search_text, raw_json)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [(c["id"], c["name"], c["amount"], c["cas"], c["location"], c["supplier"],
          " ".join([c["name"], c["cas"], c["location"], c["supplier"], c["catalogNumber"]]).lower(),
          json.dumps(c)) for c in CHEMICALS])
    db.commit()
    db.close()

# ---------------------------------------------------------------- projects
PROJECT_DEFS = [
    ("cd47", "CD47 VHH Blocker Campaign", dt(2026, 6, 2, 9, 15),
     "Isolate and characterise single-domain antibodies that block the CD47-SIRPalpha axis. "
     "Campaign runs from panning output through periplasmic expression, IMAC/SEC purification and a "
     "cell-based blocking IC50 readout."),
    ("cpgfp", "cpGFP Calcium Biosensor Engineering", dt(2026, 6, 10, 10, 0),
     "Improve the dynamic range of a circularly permuted GFP calcium sensor by linker and chromophore "
     "environment mutagenesis. Readout is an in vitro calcium titration with a Hill fit."),
    ("calb", "CalB Lipase Thermostability", dt(2026, 6, 24, 9, 30),
     "Directed evolution of Candida antarctica lipase B for thermostability. NNK libraries at the two "
     "flexible loops, activity screen on pNP-butyrate and Tm ranking by SYPRO Orange DSF."),
    ("ops", "Lab Operations and Media", dt(2026, 6, 1, 8, 20),
     "Shared bench operations: media and buffer preparation, competent cell batches, cell culture "
     "maintenance and the monthly mycoplasma screen."),
]

def make_table(headers, rows, stamp):
    base = ms(stamp)
    columns = []
    for index, title in enumerate(headers):
        columns.append({"field": f"column_{base + index}-{''.join(RNG.choice('0123456789abcdef') for _ in range(13))}",
                        "title": title})
    out_rows = []
    for row_index, values in enumerate(rows):
        row = {"id": f"row_{base + row_index}-{''.join(RNG.choice('0123456789abcdef') for _ in range(13))}"}
        for column, value in zip(columns, values):
            row[column["field"]] = str(value)
        out_rows.append(row)
    return {"columns": columns, "rows": out_rows}

# entry: (project key, protocol key, experiment name, date, result text, headers, rows, overrides, files)
NOTEBOOK_DEFS = [
    # ---- CD47 VHH campaign -------------------------------------------------
    ("cd47", "transform_hs", "Transform panning output pool into DH5alpha", dt(2026, 6, 3, 10, 20),
     "Transformed 2 uL of the round-3 panning elution into 50 uL DH5alpha.\n"
     "Plated 20 uL and 200 uL on carbenicillin plates. 340 colonies on the 20 uL plate the next morning,\n"
     "no-DNA control clean. Picked 24 colonies into the screening grid.",
     ["Plate", "Volume plated", "Colonies", "Note"],
     [["Carb 20 uL", "20 uL", "340", "Well separated, used for picking"],
      ["Carb 200 uL", "200 uL", "lawn", "Not countable"],
      ["No-DNA control", "200 uL", "0", "Clean"]],
     {"volume#0": "50 uL", "volume#1": "2 uL", "time#0": "30 min", "time#1": "45 s",
      "antibiotic#0": "carbenicillin 100 ug/mL"}, []),

    ("cd47", "pcr_colony", "Colony PCR screen of 24 panning clones", dt(2026, 6, 4, 11, 5),
     "Screened 24 colonies with the pHEN framework primers. Expected insert 420 bp.\n"
     "19 of 24 gave a clean single band at the expected size; lanes 6, 11, 14, 20 and 23 were empty.\n"
     "Sent 12 positives for Sanger sequencing.",
     ["Colony", "Band size", "Call", "Sent for sequencing"],
     [["1", "420 bp", "positive", "yes"], ["2", "420 bp", "positive", "yes"],
      ["3", "420 bp", "positive", "yes"], ["4", "420 bp", "positive", "yes"],
      ["6", "none", "negative", "no"], ["11", "none", "negative", "no"],
      ["14", "none", "negative", "no"], ["20", "none", "negative", "no"],
      ["23", "none", "negative", "no"]],
     {"value#0": "24", "value#1": "1.5", "temperature#0": "58 C", "time#1": "30 s"}, []),

    ("cd47", "miniprep", "Miniprep of 12 sequencing-positive clones", dt(2026, 6, 5, 9, 40),
     "Minipreps from 5 mL overnight cultures. Yields between 118 and 268 ng/uL in 50 uL elution.\n"
     "Sequencing returned two unique CDR3 families: C11 (7 clones) and D4 (3 clones); two clones\n"
     "carried a frameshift and were discarded.",
     ["Clone", "Yield (ng/uL)", "A260/A280", "CDR3 family"],
     [["C11-1", "241", "1.88", "C11"], ["C11-3", "212", "1.86", "C11"],
      ["C11-7", "268", "1.89", "C11"], ["D4-2", "188", "1.85", "D4"],
      ["D4-5", "176", "1.84", "D4"], ["X-9", "118", "1.79", "frameshift"]],
     {"volume#0": "5 mL", "volume#3": "50 uL", "speed#0": "13000 g"}, []),

    ("cd47", "dpni_gibson", "Subclone C11 and D4 into pET28a-His6-TEV", dt(2026, 6, 8, 14, 15),
     "Amplified both VHH ORFs with 25 nt Gibson overlaps and assembled into the NdeI/XhoI-linearised\n"
     "pET28a backbone. DpnI digest for 2 h. Assembly gave 84 colonies for C11 and 61 for D4 against\n"
     "3 colonies on the vector-only control.",
     ["Assembly", "Insert:vector", "Colonies", "Vector-only control"],
     [["pET28a-VHH_C11", "3:1", "84", "3"], ["pET28a-VHH_D4", "3:1", "61", "3"]],
     {"time#0": "2 h", "time#1": "1 h", "value#0": "3:1", "concentration#0": "50 ng/uL"}, []),

    ("cd47", "periplasmic", "Periplasmic expression of VHH C11, 1 L 2xYT", dt(2026, 6, 16, 8, 45),
     "1 L 2xYT, induced at OD600 0.62 with 0.5 mM IPTG at 20 C overnight.\n"
     "Wet cell mass 4.8 g. Osmotic shock released a clear extract; whole-cell SDS-PAGE shows a strong\n"
     "15 kDa band that is largely absent from the post-shock pellet, so most of the product is periplasmic.",
     ["Fraction", "Volume", "Total protein (mg)", "Note"],
     [["Whole cell lysate", "40 mL", "612", "Reference lane"],
      ["Periplasmic shock", "95 mL", "84", "Loaded onto IMAC"],
      ["Post-shock pellet", "-", "n/d", "Faint 15 kDa band only"]],
     {"volume#0": "1 L", "value#0": "0.6", "temperature#0": "20 C",
      "concentration#0": "0.5 mM", "time#0": "16 h", "speed#0": "6000 g"}, []),

    ("cd47", "ninta", "Ni-NTA capture of VHH C11 periplasmic extract", dt(2026, 6, 17, 10, 30),
     "Loaded 95 mL of clarified periplasmic extract onto 5 mL Ni-NTA at 4 C.\n"
     "Washed with 40 mM imidazole, eluted in 2 mL fractions with 250 mM imidazole.\n"
     "Fractions E2-E5 carry the product; total 18.4 mg by A280.",
     ["Fraction", "Volume (mL)", "A280", "mg", "Purity by gel"],
     [["Load", "95", "-", "84", "crude"], ["Flow-through", "95", "-", "63", "no 15 kDa band"],
      ["Wash 40 mM", "50", "-", "2.1", "trace"],
      ["E1", "2", "0.21", "0.6", "~70%"], ["E2", "2", "1.94", "5.4", "~90%"],
      ["E3", "2", "2.31", "6.4", "~92%"], ["E4", "2", "1.42", "3.9", "~90%"],
      ["E5", "2", "0.76", "2.1", "~85%"]],
     {"volume#0": "40 mL", "concentration#0": "20 mM", "concentration#1": "40 mM",
      "concentration#2": "250 mM", "volume#1": "5 mL", "volume#2": "2 mL",
      "time#0": "15 min", "time#1": "1 h", "speed#0": "20000 g"}, ["ninta-trace.png"]),

    ("cd47", "sec", "SEC polishing of VHH C11 on Superdex 75 16/600", dt(2026, 6, 18, 13, 0),
     "Pooled E2-E5, concentrated to 2 mL and injected at 1.0 mL/min.\n"
     "Single symmetric peak at 71.4 mL consistent with a 15 kDa monomer; small 48 mL shoulder (<4%).\n"
     "Pooled 68-76 mL, final 4.2 mg/mL, total 12.6 mg. Aliquoted 50 uL and stored at -80 C.",
     ["Peak", "Elution volume (mL)", "Apparent MW (kDa)", "Area %"],
     [["Shoulder", "48.2", "62", "3.7"], ["Main", "71.4", "15.4", "94.1"],
      ["Late", "88.0", "<5", "2.2"]],
     {"volume#0": "1.2 L", "volume#1": "2 mL", "volume#2": "2 mL",
      "value#0": "1.0", "temperature#0": "-80 C"}, ["sec-chromatogram.png"]),

    ("cd47", "sdspage", "SDS-PAGE of C11 IMAC and SEC fractions", dt(2026, 6, 18, 17, 20),
     "4-20% gradient gel, reducing conditions. Lanes: ladder, load, flow-through, wash, E1-E5, SEC pool.\n"
     "Product runs slightly above the 15 kDa marker as expected for the His-TEV-VHH fusion.\n"
     "SEC pool lane shows a single band; densitometry puts purity at 96%.",
     ["Lane", "Sample", "Main band (kDa)", "Purity %"],
     [["1", "Ladder", "-", "-"], ["2", "Periplasmic load", "15.4", "18"],
      ["3", "Flow-through", "-", "-"], ["4", "Wash 40 mM", "15.4", "9"],
      ["5", "E2", "15.4", "90"], ["6", "E3", "15.4", "92"],
      ["7", "E4", "15.4", "90"], ["8", "SEC pool", "15.4", "96"]],
     {"time#0": "5 min", "volume#0": "20 uL", "volume#1": "15 uL", "volume#2": "5 uL",
      "value#0": "150", "time#1": "45 min"}, []),

    ("cd47", "a280", "Quantification of the C11 and D4 SEC pools", dt(2026, 6, 19, 9, 10),
     "A280 with the calculated extinction coefficient 24075 M-1 cm-1 cross-checked against BCA.\n"
     "C11: 4.2 mg/mL (A280) vs 4.0 mg/mL (BCA). D4: 2.8 vs 2.6 mg/mL. Both within 10%.",
     ["Sample", "A280 (mg/mL)", "BCA (mg/mL)", "Delta %", "Total (mg)"],
     [["VHH C11 SEC pool", "4.2", "4.0", "5", "12.6"],
      ["VHH D4 SEC pool", "2.8", "2.6", "8", "7.0"]],
     {"value#0": "24075", "concentration#0": "2 mg/mL", "time#0": "30 min"}, []),

    ("cd47", "hek_passage", "Expand CD47-high stable pool for the blocking assay", dt(2026, 6, 22, 9, 50),
     "Split the CD47-high pool 1:6 into three T75 flasks at passage 9.\n"
     "Confluence at split 82%, viability 96% by trypan blue. Cells ready for the assay on 2026-06-24.",
     ["Flask", "Passage", "Split ratio", "Viability %"],
     [["T75-A", "9", "1:6", "96"], ["T75-B", "9", "1:6", "96"], ["T75-C", "9", "1:6", "95"]],
     {"volume#0": "10 mL", "volume#1": "2 mL", "time#0": "3 min", "value#0": "1:6"}, []),

    ("cd47", "flow_block", "CD47/SIRPalpha blocking IC50 of C11 and D4", dt(2026, 6, 24, 11, 25),
     "Eight-point three-fold titration from 3 uM, duplicate wells, CD47-high reporter cells.\n"
     "Biotinylated SIRPalpha-Fc at EC80 (12 nM) detected with streptavidin-APC.\n"
     "C11 IC50 = 41 nM with a full blockade plateau. D4 IC50 = 380 nM and does not reach baseline.\n"
     "Isotype VHH control flat across the range. Raw per-well MFI exported to the assay module.",
     ["Sample", "IC50 (nM)", "Hill slope", "Top MFI", "Bottom MFI", "R2"],
     [["VHH C11", "41", "1.05", "18420", "1180", "0.996"],
      ["VHH D4", "380", "0.92", "18310", "4620", "0.988"],
      ["Isotype VHH", "n.d.", "-", "18500", "17960", "-"]],
     {"concentration#0": "1e6", "volume#0": "50 uL", "value#0": "8", "time#0": "30 min",
      "concentration#1": "12 nM", "time#1": "45 min"}, ["flow-gating.png"]),

    ("cd47", "periplasmic", "Repeat periplasmic expression of VHH D4 at 25 C", dt(2026, 7, 1, 8, 30),
     "Second D4 batch induced at 25 C instead of 20 C to test whether the lower yield is expression-limited.\n"
     "Wet cell mass 5.1 g but the shock fraction titre is unchanged, so the loss is downstream of expression.\n"
     "Next attempt should use a longer 4 C shock and check the spheroplast pellet.",
     ["Condition", "Induction temp", "Wet mass (g)", "Shock yield (mg)"],
     [["Batch 1", "20 C", "4.6", "9.8"], ["Batch 2", "25 C", "5.1", "9.4"]],
     {"volume#0": "1 L", "value#0": "0.6", "temperature#0": "25 C",
      "concentration#0": "0.5 mM", "time#0": "16 h"}, []),
]

NOTEBOOK_DEFS += [
    # ---- cpGFP biosensor ---------------------------------------------------
    ("cpgfp", "pcr_q5", "Amplify cpGFP-CaM-M13 backbone for linker library", dt(2026, 6, 11, 10, 10),
     "Q5 amplification of the 5.9 kb pET21a backbone with the linker-1 randomising primers.\n"
     "Single clean band at the expected size after a Ta of 64 C; the 60 C reaction gave a faint second\n"
     "product at 1.2 kb, so 64 C was carried forward.",
     ["Reaction", "Ta", "Product", "Yield (ng/uL)", "Call"],
     [["A", "58 C", "5.9 kb + 1.2 kb", "38", "mispriming"],
      ["B", "60 C", "5.9 kb + faint 1.2 kb", "44", "borderline"],
      ["C", "64 C", "5.9 kb single", "51", "use this"],
      ["No template", "64 C", "none", "0", "clean"]],
     {"volume#0": "50 uL", "concentration#0": "0.5 uM", "mass#0": "1 ng",
      "temperature#0": "64 C", "time#1": "3 min", "value#0": "30"}, []),

    ("cpgfp", "dpni_gibson", "Assemble the linker-1 NNK library", dt(2026, 6, 12, 15, 40),
     "DpnI for 2 h, column clean-up, then Gibson at 50 C for 1 h.\n"
     "Electroporation of the whole assembly gave an estimated library size of 3.1e5 transformants,\n"
     "which covers the 4 randomised codons about 300-fold.",
     ["Metric", "Value"],
     [["Assembly reaction", "20 uL"], ["Transformants (est.)", "3.1e5"],
      ["Theoretical diversity", "1.05e3"], ["Coverage", "295x"],
      ["Vector-only background", "0.4%"]],
     {"time#0": "2 h", "time#1": "1 h", "value#0": "2:1", "concentration#0": "50 ng/uL"}, []),

    ("cpgfp", "iptg", "Express parent and 6 linker variants in 50 mL cultures", dt(2026, 6, 15, 9, 20),
     "Parallel 50 mL expressions in BL21(DE3), induced at OD600 0.7 with 0.4 mM IPTG at 18 C overnight.\n"
     "All seven pellets are visibly green. Variant L60Q gave the deepest colour and the highest wet mass.",
     ["Construct", "OD600 at induction", "Wet mass (g)", "Pellet colour"],
     [["parent", "0.71", "0.62", "green"], ["L58G", "0.68", "0.58", "pale green"],
      ["L60Q", "0.72", "0.71", "deep green"], ["L60S", "0.70", "0.60", "green"],
      ["N62D", "0.69", "0.55", "pale green"], ["T203V", "0.73", "0.66", "green"],
      ["T203S", "0.70", "0.59", "green"]],
     {"volume#0": "50 mL", "volume#1": "1 mL", "value#0": "0.7", "concentration#0": "0.4 mM",
      "temperature#0": "18 C", "time#0": "16 h", "speed#0": "6000 g", "time#1": "15 min"}, []),

    ("cpgfp", "ninta", "Parallel IMAC of 7 cpGFP variants", dt(2026, 6, 16, 11, 0),
     "Batch IMAC in 1 mL gravity columns, one column per variant.\n"
     "Yields range from 3.1 to 8.9 mg per 50 mL culture. All eluates are visibly green with no\n"
     "significant colourless contaminant band on the gel.",
     ["Variant", "Yield (mg)", "A280", "A488/A280"],
     [["parent", "6.1", "2.94", "1.42"], ["L58G", "3.1", "1.52", "1.11"],
      ["L60Q", "8.9", "4.28", "1.48"], ["L60S", "5.2", "2.51", "1.36"],
      ["N62D", "3.4", "1.66", "1.05"], ["T203V", "7.4", "3.56", "1.51"],
      ["T203S", "4.8", "2.31", "1.29"]],
     {"volume#0": "10 mL", "concentration#0": "20 mM", "concentration#1": "40 mM",
      "concentration#2": "250 mM", "volume#1": "1 mL", "volume#2": "1 mL"}, []),

    ("cpgfp", "ca_titration", "Calcium titration of the 7-variant panel", dt(2026, 6, 19, 14, 30),
     "Eleven-point free-calcium series from 0 to 39 uM using the EGTA/CaEGTA calibration set.\n"
     "T203V improves the dynamic range from 4.8 to 9.6 with a modest Kd shift; L60Q is brighter\n"
     "but the dynamic range is unchanged. N62D loses calcium responsiveness almost entirely.\n"
     "Per-well fluorescence exported to the assay module for the Hill fit.",
     ["Variant", "F0", "Fmax", "Dynamic range", "Kd (nM)", "Hill n"],
     [["parent", "1.00", "4.8", "4.8", "285", "2.1"],
      ["L58G", "1.00", "3.2", "3.2", "410", "1.8"],
      ["L60Q", "1.00", "5.1", "5.1", "262", "2.2"],
      ["L60S", "1.00", "4.4", "4.4", "318", "2.0"],
      ["N62D", "1.00", "1.3", "1.3", "n.d.", "n.d."],
      ["T203V", "1.00", "9.6", "9.6", "204", "2.4"],
      ["T203S", "1.00", "6.2", "6.2", "241", "2.2"]],
     {"value#0": "11", "concentration#0": "0.2 mg/mL", "temperature#0": "25 C",
      "time#0": "15 min", "value#1": "488"}, ["ca-titration-curves.png"]),

    ("cpgfp", "sdspage", "Purity check of the cpGFP variant panel", dt(2026, 6, 20, 10, 15),
     "One gel, seven lanes plus ladder. All variants run at the expected 47 kDa.\n"
     "N62D shows an extra 32 kDa band consistent with linker cleavage, which explains the loss of\n"
     "calcium response. Everything else is above 90% pure.",
     ["Lane", "Variant", "Main band (kDa)", "Extra bands", "Purity %"],
     [["2", "parent", "47", "none", "94"], ["3", "L58G", "47", "none", "91"],
      ["4", "L60Q", "47", "none", "95"], ["5", "L60S", "47", "none", "92"],
      ["6", "N62D", "47", "32 kDa strong", "61"], ["7", "T203V", "47", "none", "96"],
      ["8", "T203S", "47", "faint 32 kDa", "89"]],
     {"time#0": "5 min", "volume#0": "20 uL", "volume#1": "12 uL",
      "value#0": "150", "time#1": "45 min"}, []),

    ("cpgfp", "miniprep", "Miniprep and sequence confirm T203V and L60Q", dt(2026, 7, 2, 9, 45),
     "Fresh minipreps from single colonies of the two lead variants; both sequences match the design\n"
     "with no secondary mutations across the whole cpGFP-CaM-M13 cassette.",
     ["Clone", "Yield (ng/uL)", "A260/A280", "Sequence call"],
     [["T203V-c2", "276", "1.87", "perfect match"], ["L60Q-c4", "254", "1.86", "perfect match"]],
     {"volume#0": "5 mL", "volume#3": "50 uL"}, []),

    # ---- CalB thermostability ---------------------------------------------
    ("calb", "transform_electro", "Electroporate the CalB NNK library", dt(2026, 6, 25, 13, 20),
     "Drop-dialysed the assembly for 30 min before pulsing. Time constant 5.2 ms, no arcing.\n"
     "Library size 4.8e6 from four pulses, which is ample coverage for the two 3-codon windows.",
     ["Pulse", "Time constant (ms)", "cfu", "Note"],
     [["1", "5.2", "1.3e6", "clean"], ["2", "5.1", "1.2e6", "clean"],
      ["3", "5.3", "1.1e6", "clean"], ["4", "4.9", "1.2e6", "clean"]],
     {"volume#1": "50 uL", "volume#2": "2 uL", "value#0": "1.8",
      "volume#3": "950 uL", "time#0": "1 h", "antibiotic#0": "chloramphenicol 34 ug/mL"}, []),

    ("calb", "pnp_lipase", "Primary activity screen, 88 library clones", dt(2026, 6, 29, 10, 0),
     "88 library clones plus 4 wild-type and 4 empty-vector wells in one 96-well plate.\n"
     "Read A405 every 15 s for 10 min at 37 C. Eleven clones exceed 1.4-fold of the wild-type rate;\n"
     "the plate CV on the wild-type wells is 6.8%, so the hit threshold is well outside noise.",
     ["Well", "Clone", "Rate (mOD/min)", "Fold vs WT", "Call"],
     [["A1", "WT", "182", "1.00", "reference"], ["A2", "WT", "176", "0.97", "reference"],
      ["C4", "L1-14", "268", "1.47", "hit"], ["C9", "L1-19", "254", "1.40", "hit"],
      ["E2", "L2-31", "301", "1.65", "hit"], ["E7", "L2-36", "288", "1.58", "hit"],
      ["F11", "L2-52", "246", "1.35", "borderline"],
      ["H12", "empty vector", "8", "0.04", "background"]],
     {"concentration#0": "50 ug/mL", "concentration#1": "10 mM", "volume#0": "180 uL",
      "time#0": "10 min", "volume#1": "20 uL", "time#1": "10 min"}, ["pnp-kinetics.png"]),

    ("calb", "pnp_lipase", "Confirmation screen of the 11 primary hits", dt(2026, 7, 6, 11, 30),
     "Re-picked and re-assayed the eleven primary hits in triplicate from fresh cultures.\n"
     "Seven confirm above 1.3-fold. L2-31 is the strongest at 1.63-fold and was sequenced:\n"
     "it carries D223G and L278M.",
     ["Clone", "Mean rate (mOD/min)", "SD", "Fold vs WT", "Confirmed"],
     [["L1-14", "241", "14", "1.33", "yes"], ["L1-19", "228", "11", "1.26", "no"],
      ["L2-31", "296", "9", "1.63", "yes"], ["L2-36", "271", "17", "1.49", "yes"],
      ["L2-52", "238", "21", "1.31", "yes"], ["L1-07", "199", "12", "1.10", "no"],
      ["WT", "181", "12", "1.00", "-"]],
     {"concentration#0": "50 ug/mL", "concentration#1": "10 mM", "volume#0": "180 uL"}, []),

    ("calb", "ninta", "Purify CalB WT and D223G/L278M for DSF", dt(2026, 7, 15, 9, 15),
     "Both proteins purified in parallel from 500 mL arabinose-induced cultures.\n"
     "Yields 8.2 mg (WT) and 7.1 mg (variant). Both eluates are clean enough for DSF without SEC.",
     ["Sample", "Culture (mL)", "Yield (mg)", "Purity %"],
     [["CalB WT", "500", "8.2", "93"], ["CalB D223G/L278M", "500", "7.1", "91"]],
     {"volume#0": "25 mL", "concentration#0": "20 mM", "concentration#2": "250 mM"}, []),

    ("calb", "tsa", "Thermal shift ranking of round-1 variants", dt(2026, 7, 18, 14, 45),
     "SYPRO Orange DSF, triplicate wells, 1 C/min from 25 to 95 C.\n"
     "D223G/L278M shifts Tm by +6.4 C over wild type with no loss of specific activity.\n"
     "L2-36 (S150T) gives +3.1 C. The single mutants of the double show partial additivity.",
     ["Variant", "Tm (C)", "SD", "Delta Tm (C)", "Relative activity"],
     [["WT", "52.8", "0.2", "0.0", "1.00"], ["D223G", "56.1", "0.3", "3.3", "1.04"],
      ["L278M", "55.2", "0.2", "2.4", "0.98"], ["D223G/L278M", "59.2", "0.2", "6.4", "1.09"],
      ["S150T (L2-36)", "55.9", "0.4", "3.1", "1.02"]],
     {"concentration#0": "0.2 mg/mL", "value#0": "5", "volume#0": "20 uL", "value#1": "1.0"},
     ["dsf-melt-curves.png"]),

    ("calb", "sdspage", "Purity of the CalB DSF panel", dt(2026, 7, 18, 17, 5),
     "Single gel with the five DSF samples. All run at 33 kDa. Wild type shows a faint 66 kDa dimer\n"
     "band that is absent from the double mutant, which is consistent with the cleaner melt curve.",
     ["Lane", "Sample", "Main band (kDa)", "Note"],
     [["2", "WT", "33", "faint 66 kDa"], ["3", "D223G", "33", "clean"],
      ["4", "L278M", "33", "clean"], ["5", "D223G/L278M", "33", "clean"],
      ["6", "S150T", "33", "faint 66 kDa"]],
     {"time#0": "5 min", "volume#0": "20 uL", "value#0": "150"}, []),

    # ---- Lab operations ----------------------------------------------------
    ("ops", "media_2xyt", "2xYT batch 2026-06-01, 4 x 1 L", dt(2026, 6, 1, 8, 30),
     "Four 1 L bottles prepared from the same weigh-out and autoclaved on the 20 min liquid cycle.\n"
     "pH after autoclaving 7.02. Bottles labelled 2xYT-260601-1 through -4 and shelved.",
     ["Bottle", "pH before", "pH after", "Sterility check 48 h"],
     [["2xYT-260601-1", "7.00", "7.02", "clear"], ["2xYT-260601-2", "7.00", "7.03", "clear"],
      ["2xYT-260601-3", "7.00", "7.01", "clear"], ["2xYT-260601-4", "7.00", "7.02", "clear"]],
     {"mass#0": "16 g", "mass#1": "10 g", "mass#2": "5 g", "volume#0": "900 mL",
      "value#0": "7.0", "time#0": "20 min"}, []),

    ("ops", "media_lbagar", "LB-kanamycin plates, 60 plates", dt(2026, 6, 2, 14, 10),
     "Poured 60 LB-kan plates from 1.5 L of molten agar cooled to 55 C.\n"
     "No-DNA control plated from an old competent cell batch stayed clean after 24 h.",
     ["Batch", "Plates", "Antibiotic", "Control"],
     [["LBK-260602", "60", "kanamycin 50 ug/mL", "clean at 24 h"]],
     {"mass#0": "37.5 g", "volume#0": "1.5 L", "time#0": "30 min",
      "antibiotic#0": "kanamycin 50 ug/mL", "concentration#0": "50 ug/mL", "volume#1": "25 mL"}, []),

    ("ops", "comp_cells", "RbCl competent BL21(DE3) batch 2026-06-05", dt(2026, 6, 5, 8, 40),
     "200 mL culture harvested at OD600 0.41. 120 aliquots of 100 uL snap frozen.\n"
     "Batch efficiency measured with 100 pg pUC19: 2.4e8 cfu/ug, which is the best batch this year.",
     ["Metric", "Value"],
     [["Harvest OD600", "0.41"], ["Aliquots", "120"], ["Volume per aliquot", "100 uL"],
      ["Efficiency (cfu/ug)", "2.4e8"], ["Storage", "-80 C box GS-2026"]],
     {"volume#0": "200 mL", "volume#1": "2 mL", "value#0": "0.4", "speed#0": "4000 g",
      "time#0": "10 min", "time#1": "1 h", "volume#2": "100 uL"}, []),

    ("ops", "comp_cells", "RbCl competent DH5alpha batch 2026-07-20", dt(2026, 7, 20, 8, 50),
     "Second batch of the quarter. Harvest OD600 0.44, 96 aliquots.\n"
     "Efficiency 8.1e7 cfu/ug, lower than the BL21 batch; the cells sat on ice for an extra 20 min\n"
     "while the centrifuge was in use, which is the most likely cause.",
     ["Metric", "Value"],
     [["Harvest OD600", "0.44"], ["Aliquots", "96"], ["Efficiency (cfu/ug)", "8.1e7"],
      ["Deviation", "Extra 20 min on ice before the TFB1 step"]],
     {"volume#0": "200 mL", "value#0": "0.4", "time#1": "1 h 20 min"}, []),

    ("ops", "mycoplasma", "Monthly mycoplasma screen, August 2026", dt(2026, 8, 3, 10, 20),
     "Screened five active lines. All negative; positive control gave the expected 270 bp band.\n"
     "Gel image archived. Next screen due 2026-09-01.",
     ["Line", "Passage", "Result", "Band"],
     [["HEK293T parental", "P14", "negative", "none"],
      ["HEK293T CD47-high", "P11", "negative", "none"],
      ["HEK293T CD47 KO 2F", "P8", "negative", "none"],
      ["Jurkat E6-1", "P22", "negative", "none"],
      ["Positive control", "-", "positive", "270 bp"]],
     {"volume#0": "1 mL", "time#0": "72 h", "time#1": "5 min", "volume#1": "2 uL"}, []),

    ("ops", "hek_passage", "Weekly HEK293T maintenance, week of 2026-08-17", dt(2026, 8, 17, 9, 5),
     "Routine 1:8 split of the parental line at 85% confluence, passage 16.\n"
     "Viability 97%. Nothing unusual.",
     ["Flask", "Passage", "Confluence %", "Split", "Viability %"],
     [["T75", "16", "85", "1:8", "97"]],
     {"volume#0": "10 mL", "volume#1": "2 mL", "time#0": "3 min", "value#0": "1:8"}, []),

    ("ops", "agarose", "Reference 1% agarose gel for the CalB library QC", dt(2026, 6, 26, 15, 30),
     "1% TAE gel of the library assembly and the linearised vector control.\n"
     "Vector runs as a single 5.4 kb band; the assembly lane shows the expected ladder of\n"
     "concatemers, which is normal for an unpurified Gibson reaction.",
     ["Lane", "Sample", "Observed", "Call"],
     [["1", "1 kb ladder", "-", "-"], ["2", "Linearised pBAD33", "5.4 kb", "clean"],
      ["3", "Gibson assembly", "5.4 kb + high MW smear", "expected"],
      ["4", "Uncut vector", "supercoiled 3.8 kb apparent", "expected"]],
     {"mass#0": "1 g", "volume#0": "100 mL", "value#0": "1.0", "time#0": "30 min",
      "volume#1": "10 uL", "volume#2": "5 uL", "value#1": "110", "time#1": "45 min"}, []),
]

# ---------------------------------------------------------------- figures
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

# embed TrueType so the PDFs carry extractable text like a real paper
matplotlib.rcParams['pdf.fonttype'] = 42

def fig_save(fig, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fig.savefig(path, dpi=110, bbox_inches="tight")
    plt.close(fig)

def four_pl(x, bottom, top, ic50, hill):
    return bottom + (top - bottom) / (1.0 + (x / ic50) ** hill)

def make_result_figure(name, path):
    rng = np.random.default_rng(abs(hash(name)) % (2 ** 32))
    fig, ax = plt.subplots(figsize=(5.2, 3.6))
    if name == "ninta-trace.png":
        v = np.linspace(0, 160, 800)
        a280 = (0.05 + 2.4 * np.exp(-((v - 108) ** 2) / 18) + 0.35 * np.exp(-((v - 96) ** 2) / 40)
                + 0.9 * np.exp(-((v - 12) ** 2) / 120))
        imid = np.clip((v - 92) * 8, 0, 250) * (v < 140) + 250 * (v >= 140)
        ax.plot(v, a280, color="#1f4e79", lw=1.4, label="A280")
        ax2 = ax.twinx()
        ax2.plot(v, imid, color="#b03a2e", lw=1.0, ls="--", label="imidazole (mM)")
        ax2.set_ylabel("imidazole (mM)")
        ax.set_xlabel("volume (mL)"); ax.set_ylabel("A280")
        ax.set_title("Ni-NTA capture, VHH CD47 C11")
        ax.legend(loc="upper left", fontsize=8)
    elif name == "sec-chromatogram.png":
        v = np.linspace(30, 120, 900)
        a280 = (0.02 + 2.9 * np.exp(-((v - 71.4) ** 2) / 6.0) + 0.11 * np.exp(-((v - 48.2) ** 2) / 5.0)
                + 0.06 * np.exp(-((v - 88.0) ** 2) / 4.0))
        ax.plot(v, a280 + rng.normal(0, 0.004, v.size), color="#1f4e79", lw=1.3)
        ax.axvspan(68, 76, color="#7fb069", alpha=0.25, label="pooled 68-76 mL")
        ax.set_xlabel("elution volume (mL)"); ax.set_ylabel("A280")
        ax.set_title("Superdex 75 16/600, VHH CD47 C11"); ax.legend(fontsize=8)
    elif name == "flow-gating.png":
        conc = np.logspace(-1, 3.5, 8)
        for label, ic50, bottom, color in (("VHH C11", 41, 1180, "#1f4e79"),
                                           ("VHH D4", 380, 4620, "#b03a2e"),
                                           ("Isotype", 1e9, 17960, "#7f7f7f")):
            y = four_pl(conc, bottom, 18420, ic50, 1.0) + rng.normal(0, 260, conc.size)
            ax.semilogx(conc, y, "o", color=color, ms=5)
            smooth = np.logspace(-1, 3.5, 200)
            ax.semilogx(smooth, four_pl(smooth, bottom, 18420, ic50, 1.0), color=color, lw=1.2, label=label)
        ax.set_xlabel("VHH (nM)"); ax.set_ylabel("SIRPa-Fc binding, APC gMFI")
        ax.set_title("CD47 blockade on CD47-high HEK293T"); ax.legend(fontsize=8)
    elif name == "ca-titration-curves.png":
        ca = np.logspace(0, 4.6, 40)
        for label, kd, fmax, hill, color in (("parent", 285, 4.8, 2.1, "#1f4e79"),
                                             ("T203V", 204, 9.6, 2.4, "#2e7d32"),
                                             ("L60Q", 262, 5.1, 2.2, "#ef6c00"),
                                             ("N62D", 900, 1.3, 1.2, "#7f7f7f")):
            y = 1 + (fmax - 1) * ca ** hill / (kd ** hill + ca ** hill)
            ax.semilogx(ca, y, lw=1.4, color=color, label=label)
        ax.set_xlabel("free Ca2+ (nM)"); ax.set_ylabel("F / F0")
        ax.set_title("Calcium titration, cpGFP variants"); ax.legend(fontsize=8)
    elif name == "pnp-kinetics.png":
        t = np.linspace(0, 600, 41)
        for label, rate, color in (("L2-31", 301, "#2e7d32"), ("L2-36", 288, "#66bb6a"),
                                   ("WT", 182, "#1f4e79"), ("empty vector", 8, "#7f7f7f")):
            y = rate / 1000 * t / 60 + rng.normal(0, 0.004, t.size) + 0.05
            ax.plot(t, y, lw=1.3, color=color, label=label)
        ax.set_xlabel("time (s)"); ax.set_ylabel("A405")
        ax.set_title("pNP-butyrate hydrolysis, 37 C"); ax.legend(fontsize=8)
    elif name == "dsf-melt-curves.png":
        temp = np.linspace(25, 95, 280)
        for label, tm, color in (("WT", 52.8, "#1f4e79"), ("D223G", 56.1, "#ef6c00"),
                                 ("L278M", 55.2, "#8e24aa"), ("D223G/L278M", 59.2, "#2e7d32")):
            y = 1 / (1 + np.exp(-(temp - tm) / 1.6)) - 0.35 / (1 + np.exp(-(temp - 82) / 3.0))
            ax.plot(temp, y + rng.normal(0, 0.004, temp.size), lw=1.3, color=color, label=f"{label} (Tm {tm} C)")
        ax.set_xlabel("temperature (C)"); ax.set_ylabel("normalised SYPRO Orange signal")
        ax.set_title("Thermal shift, CalB round-1 variants"); ax.legend(fontsize=8)
    else:
        ax.plot(rng.normal(0, 1, 60).cumsum(), color="#1f4e79")
        ax.set_title(name)
    ax.grid(alpha=0.25, lw=0.5)
    fig_save(fig, path)

# ---------------------------------------------------------------- projects on disk
def write_projects():
    projects = {}
    for key, name, created, description in PROJECT_DEFS:
        projects[key] = {
            "id": mkid(created),
            "key": key,
            "name": name,
            "description": description,
            "createdAt": iso(created),
            "updatedAt": iso(created),
            "folder": os.path.join(ROOT, "Project", sanitize(name)),
            "entries": [],
        }

    notebook_entries = []
    for (pkey, protokey, experiment, when, result, headers, rows, overrides, files) in NOTEBOOK_DEFS:
        project = projects[pkey]
        protocol = PROTOCOLS[protokey]
        entry_id = mkid(when)
        page_dir = os.path.join(project["folder"], "Notebook", folder(protocol["name"], entry_id))
        result_records = []
        for file_name in files:
            abs_path = os.path.join(page_dir, "ResultFiles", file_name)
            make_result_figure(file_name, abs_path)
            result_records.append({
                "name": file_name,
                "path": abs_path,
                "relativePath": rel(abs_path),
                "mimeType": "image/png",
                "size": os.path.getsize(abs_path),
                "importedAt": iso(when + timedelta(minutes=42)),
            })
        entry = {
            "id": entry_id,
            "notebookType": "biology",
            "projectId": project["id"],
            "projectName": project["name"],
            "protocolId": protocol["id"],
            "protocolName": protocol["name"],
            "experimentName": experiment,
            "protocolSnapshot": protocol_snapshot(protocol),
            "values": protocol_values(protocol, overrides),
            "result": result,
            "resultTable": make_table(headers, rows, when),
            "resultFiles": [record["name"] for record in result_records],
            "resultFileRecords": result_records,
            "resultFileAddresses": [],
            "notebookState": "executed",
            "executedAt": iso(when + timedelta(hours=3)),
            "agentDraftStatus": "",
            "agentDraftMeta": {"workflowId": "", "proposalId": ""},
            "createdAt": iso(when),
            "updatedAt": iso(when + timedelta(hours=4)),
            "storageFolder": page_dir,
        }
        entry["resultTables"] = [entry["resultTable"]]
        wjson(os.path.join(page_dir, "page.json"),
              envelope("hikari_notebook_pages", "notebookEntry", entry))
        wjsonl(os.path.join(page_dir, "page.log"), [
            {"ts": iso(when), "action": "create", "entryId": entry_id,
             "summary": f'Created notebook page "{protocol["name"]}"',
             "details": {"notebookType": "biology", "projectName": project["name"],
                         "protocolName": protocol["name"], "experimentName": experiment,
                         "importedFileCount": 0}},
            {"ts": iso(when + timedelta(hours=3)), "action": "execute", "entryId": entry_id,
             "summary": "Marked page as executed and saved the result table",
             "details": {"rows": len(rows), "columns": len(headers),
                         "resultFileCount": len(result_records)}},
            {"ts": iso(when + timedelta(hours=4)), "action": "update", "entryId": entry_id,
             "summary": "Updated result text",
             "details": {"characters": len(result)}},
        ])
        project["entries"].append(entry)
        project["updatedAt"] = max(project["updatedAt"], entry["updatedAt"])
        notebook_entries.append(entry)

    for project in projects.values():
        conclusions = [
            f'{entry["experimentName"]}; {entry["result"].splitlines()[-1].strip()}'
            for entry in project["entries"][-4:]
        ] or ["- None recorded."]
        memory = "\n".join([
            "<!-- hikari:auto -->",
            "# Project Memory",
            "",
            f'Name: {project["name"]}',
            f'Description: {project["description"]}',
            f'Created: {project["createdAt"]}',
            f'Updated: {project["updatedAt"]}',
            "",
            "## Paper Conclusions",
            *PROJECT_PAPER_MEMORY.get(project["key"], ["- None recorded.", ""]),
            "## Experimental Conclusions",
            *conclusions,
            "",
            "<!-- /hikari:auto -->",
        ])
        wtext(os.path.join(project["folder"], "MEMORY.md"), memory)
        research_memory = {}
        for entry in project["entries"]:
            research_memory[f'notebook:{entry["id"]}'] = {
                "hash": hashlib.sha256(entry["result"].encode()).hexdigest(),
                "conclusion": entry["result"].splitlines()[-1].strip(),
                "generatedAt": iso(datetime.fromisoformat(entry["updatedAt"].replace("Z", "+00:00"))
                                   + timedelta(minutes=12)),
                "model": "gpt-5.4-mini",
            }
        wjson(os.path.join(project["folder"], ".hikari", "research-memory.json"), research_memory)
        # per-project agent skills mirror the root ones
        skills_src = os.path.join(SRC, ".agents", "skills")
        skills_dst = os.path.join(project["folder"], ".agents", "skills")
        if os.path.isdir(skills_src) and not os.path.isdir(skills_dst):
            shutil.copytree(skills_src, skills_dst)
        os.makedirs(os.path.join(project["folder"], "Papers"), exist_ok=True)
    return projects, notebook_entries

# ---------------------------------------------------------------- papers
# Synthetic reference documents. Titles, authors, journals and DOIs are fictional;
# the 10.5555 prefix is the reserved DOI test prefix. Each PDF says so on page 1.
PAPER_DEFS = [
    ("CD47_SIRPalpha_blockade_nanobody_therapeutics",
     "Single-domain antibodies that block the CD47-SIRPalpha checkpoint",
     "10.5555/jper.2026.0114", "Journal of Protein Engineering Reports", "2026",
     ["R. Okonkwo", "L. Bergstrom", "H. Tanaka"],
     "A panel of camelid VHH domains raised against human CD47 is characterised for blockade of the "
     "SIRPalpha interaction. The strongest binder blocks with a cell-surface IC50 in the low tens of "
     "nanomolar and retains activity after 24 h at 37 C.",
     "ready"),
    ("CD47_SIRPalpha_blockade_nanobody_therapeutics",
     "Structural determinants of CD47 recognition by camelid VHH domains",
     "10.5555/sbr.2026.0087", "Structural Biology Reports", "2026",
     ["M. Delacroix", "S. Nair"],
     "Crystal structures of three anti-CD47 VHH domains show that the blocking epitope overlaps the "
     "SIRPalpha binding site and that CDR3 length correlates with the depth of the pocket contact.",
     "ready"),
    ("CD47_SIRPalpha_blockade_nanobody_therapeutics",
     "Periplasmic expression strategies for nanobody production in Escherichia coli",
     "10.5555/mbl.2026.0032", "Molecular Biosensor Letters", "2026",
     ["A. Ferreira", "K. Vogel", "P. Osei"],
     "Comparison of pelB, DsbA and OmpA leader sequences for VHH secretion. Induction at 20 C with "
     "0.5 mM IPTG and a two-step cold osmotic shock recovers the largest fraction of folded product.",
     "ready"),
    ("Genetically_encoded_calcium_indicators_design",
     "Linker optimisation in circularly permuted GFP calcium indicators",
     "10.5555/mbl.2026.0041", "Molecular Biosensor Letters", "2026",
     ["Y. Sandoval", "T. Iqbal"],
     "Systematic NNK randomisation of the two linkers flanking cpGFP identifies substitutions that "
     "raise the dynamic range without shifting the apparent calcium affinity.",
     "ready"),
    ("Genetically_encoded_calcium_indicators_design",
     "Chromophore environment mutations tune the dynamic range of GECIs",
     "10.5555/jper.2026.0129", "Journal of Protein Engineering Reports", "2026",
     ["N. Abebe", "C. Lindqvist", "J. Moreau"],
     "Position 203 substitutions modulate the protonation equilibrium of the cpGFP chromophore. "
     "T203V roughly doubles the calcium-dependent fluorescence change in vitro.",
     "ready"),
    ("Lipase_thermostability_directed_evolution",
     "Loop rigidification improves the thermostability of a fungal lipase",
     "10.5555/jper.2026.0140", "Journal of Protein Engineering Reports", "2026",
     ["G. Marchetti", "D. Ansah"],
     "Two flexible surface loops dominate the thermal unfolding of the lipase. Rigidifying "
     "substitutions in either loop raise Tm by 2-4 C and combine near-additively.",
     "ready"),
    ("Lipase_thermostability_directed_evolution",
     "High-throughput screening of lipase libraries with chromogenic esters",
     "10.5555/aer.2026.0058", "Applied Enzymology Reviews", "2026",
     ["S. Whitfield", "R. Kaur"],
     "Practical guidance for pNP-ester plate assays: substrate stability, blank subtraction and the "
     "false-positive rate expected from a 96-well primary screen.",
     "pending"),
    ("Protein_purification_methods_reference",
     "Practical imidazole gradients for IMAC of small his-tagged binders",
     "10.5555/pmr.2026.0011", "Purification Methods Reference", "2025",
     ["E. Novak", "B. Adeyemi"],
     "A 40 mM imidazole wash removes most host contaminants from small binder preparations without "
     "measurable loss of product.",
     "ready"),
    ("Protein_purification_methods_reference",
     "Differential scanning fluorimetry as a stability triage tool",
     "10.5555/pmr.2026.0019", "Purification Methods Reference", "2026",
     ["I. Petrova", "M. Haddad"],
     "SYPRO Orange DSF ranks variant stability reproducibly when the protein is above 0.1 mg/mL and "
     "the buffer is free of detergent.",
     "error"),
    ("Protein_purification_methods_reference",
     "Size-exclusion chromatography for oligomeric state assignment",
     "10.5555/pmr.2026.0024", "Purification Methods Reference", "2026",
     ["F. Chalmers"],
     "Calibration practice for analytical SEC and the limits of apparent molecular weight assignment "
     "for elongated single-domain proteins.",
     "pending"),
]

# papers filed inside a project folder rather than a journal club folder
PROJECT_PAPER_DEFS = [
    ("cd47", "Cell-based potency assays for checkpoint-blocking binders",
     "10.5555/aer.2026.0061", "Applied Enzymology Reviews", "2026", ["V. Rautio", "O. Mbeki"],
     "Design of flow cytometric blocking assays, including how to pick the ligand concentration "
     "from a prior saturation titration."),
    ("cd47", "Stability of single-domain antibodies in serum",
     "10.5555/jper.2026.0151", "Journal of Protein Engineering Reports", "2026", ["L. Bergstrom"],
     "VHH domains retain binding after 48 h in 50% human serum at 37 C; loss is dominated by "
     "aggregation rather than proteolysis."),
    ("cpgfp", "Calibration buffers for free calcium titrations",
     "10.5555/mbl.2026.0049", "Molecular Biosensor Letters", "2025", ["T. Iqbal", "Y. Sandoval"],
     "Preparation and validation of EGTA/CaEGTA buffer series, including the temperature and ionic "
     "strength corrections that matter in practice."),
    ("calb", "Arabinose-inducible expression of secreted fungal enzymes",
     "10.5555/aer.2026.0064", "Applied Enzymology Reviews", "2026", ["D. Ansah", "G. Marchetti"],
     "pBAD titration data showing that 0.02% arabinose gives the best soluble yield for lipase B."),
]

PROJECT_PAPER_MEMORY = {
    "cd47": [
        "### Single-domain antibodies that block the CD47-SIRPalpha checkpoint",
        "- Summary: Low-nanomolar cell-surface blockade is achievable with an unmodified VHH domain; "
        "our C11 IC50 of 41 nM sits in the same range.",
        "- Document type: Research article",
        "- DOI: 10.5555/jper.2026.0114",
        "- Source: `Papers/CD47_SIRPalpha_blockade_nanobody_therapeutics/"
        "Single-domain_antibodies_that_block_the_CD47-SIRPalpha_checkpoint.pdf`",
        "",
        "### Periplasmic expression strategies for nanobody production in Escherichia coli",
        "- Summary: 20 C induction with a two-step cold osmotic shock recovers the most folded product, "
        "which matches what we saw when 25 C gave no improvement.",
        "- Document type: Research article",
        "- DOI: 10.5555/mbl.2026.0032",
        "- Source: `Papers/CD47_SIRPalpha_blockade_nanobody_therapeutics/"
        "Periplasmic_expression_strategies_for_nanobody_production_in_Escherichia_coli.pdf`",
        "",
    ],
    "cpgfp": [
        "### Chromophore environment mutations tune the dynamic range of GECIs",
        "- Summary: Position 203 substitutions roughly double the calcium-dependent fluorescence change; "
        "our T203V result (4.8 -> 9.6) reproduces this.",
        "- Document type: Research article",
        "- DOI: 10.5555/jper.2026.0129",
        "- Source: `Papers/Genetically_encoded_calcium_indicators_design/"
        "Chromophore_environment_mutations_tune_the_dynamic_range_of_GECIs.pdf`",
        "",
    ],
    "calb": [
        "### Loop rigidification improves the thermostability of a fungal lipase",
        "- Summary: Two surface loops dominate thermal unfolding and rigidifying substitutions combine "
        "near-additively, consistent with the +3.3 / +2.4 / +6.4 C series we measured.",
        "- Document type: Research article",
        "- DOI: 10.5555/jper.2026.0140",
        "- Source: `Papers/Lipase_thermostability_directed_evolution/"
        "Loop_rigidification_improves_the_thermostability_of_a_fungal_lipase.pdf`",
        "",
    ],
    "ops": ["- None recorded.", ""],
}

from matplotlib.backends.backend_pdf import PdfPages

SECTION_BODY = {
    "Abstract": "{abstract}",
    "1. Introduction": (
        "The system studied here has been described in outline elsewhere, but the quantitative "
        "behaviour under bench conditions is poorly documented. We set out to measure it directly "
        "and to record the conditions under which the measurement is reproducible. Throughout we "
        "report the raw observable alongside the derived parameter so that the fit can be repeated "
        "from the deposited numbers."),
    "2. Materials and methods": (
        "Constructs were assembled by isothermal assembly of PCR fragments carrying 25 nt overlaps "
        "and verified across the full cassette by Sanger sequencing. Protein was produced in E. coli "
        "BL21(DE3) grown in 2xYT, induced at OD600 0.6-0.7 and expressed overnight at 18-20 C. "
        "Clarified extract was captured on Ni-NTA, washed at 40 mM imidazole and eluted at 250 mM, "
        "then polished by size-exclusion chromatography in 20 mM HEPES, 150 mM NaCl, pH 7.4. "
        "Concentrations were determined by A280 using calculated extinction coefficients and "
        "cross-checked by BCA. All measurements are the mean of at least three independent "
        "preparations unless stated otherwise."),
    "3. Results": (
        "The purified material behaved as a single species by analytical size-exclusion "
        "chromatography, with less than 5% of the absorbance in the void. Titrations were fitted "
        "with a four-parameter logistic model; residuals were unstructured across the whole "
        "concentration range. Replicate preparations agreed within the plate-level coefficient of "
        "variation, which was below 8% in every experiment reported here. The parameter of interest "
        "moved outside that band only for the substitutions discussed below, so we treat the "
        "remaining differences as not meaningful."),
    "4. Discussion": (
        "The practical conclusion is narrow: the effect is real, it is reproducible between "
        "preparations, and it survives the buffer changes we tested. We did not test the effect in "
        "the presence of serum or at physiological temperature for extended periods, and neither "
        "condition should be assumed from these data. The most useful follow-up would combine the "
        "substitutions reported here with the loop changes described in the accompanying work."),
    "5. Data availability": (
        "Raw per-well readings, fitting scripts and construct maps are available from the "
        "corresponding author on request. This document is synthetic sample content generated for "
        "Hikari storage-root test data and does not report real experiments."),
}

def write_paper_pdf(path, title, journal, year, authors, doi, abstract):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with PdfPages(path) as pdf:
        # --- page 1: title + abstract + intro
        fig = plt.figure(figsize=(8.27, 11.69))
        fig.text(0.08, 0.955, journal, size=8.5, style="italic", color="#555555")
        fig.text(0.08, 0.94, f"doi:{doi}  ·  {year}", size=8, color="#777777")
        wrapped_title = textwrap.fill(title, 52)
        fig.text(0.08, 0.90, wrapped_title, size=15, weight="bold", va="top")
        fig.text(0.08, 0.90 - 0.035 * (wrapped_title.count("\n") + 1), ", ".join(authors), size=9.5)
        y = 0.90 - 0.035 * (wrapped_title.count("\n") + 1) - 0.04
        for heading in ("Abstract", "1. Introduction"):
            body = SECTION_BODY[heading].format(abstract=abstract)
            fig.text(0.08, y, heading, size=10.5, weight="bold")
            y -= 0.022
            text = textwrap.fill(body, 92)
            fig.text(0.08, y, text, size=8.6, va="top", linespacing=1.55)
            y -= 0.020 * (text.count("\n") + 1) + 0.03
        fig.text(0.08, 0.035, "Synthetic sample document generated for Hikari test data.",
                 size=7.5, color="#999999")
        fig.text(0.92, 0.035, "1", size=8, ha="right", color="#999999")
        pdf.savefig(fig); plt.close(fig)

        # --- page 2: methods + results
        fig = plt.figure(figsize=(8.27, 11.69))
        y = 0.93
        for heading in ("2. Materials and methods", "3. Results"):
            fig.text(0.08, y, heading, size=10.5, weight="bold")
            y -= 0.022
            text = textwrap.fill(SECTION_BODY[heading], 92)
            fig.text(0.08, y, text, size=8.6, va="top", linespacing=1.55)
            y -= 0.020 * (text.count("\n") + 1) + 0.035
        fig.text(0.92, 0.035, "2", size=8, ha="right", color="#999999")
        pdf.savefig(fig); plt.close(fig)

        # --- page 3: a figure
        rng = np.random.default_rng(abs(hash(doi)) % (2 ** 32))
        fig = plt.figure(figsize=(8.27, 11.69))
        ax = fig.add_axes([0.14, 0.56, 0.72, 0.30])
        x = np.logspace(-1, 3.5, 9)
        for index, (label, ic50) in enumerate((("construct A", 41), ("construct B", 180), ("control", 1e6))):
            y_vals = four_pl(x, 0.03, 1.0, ic50, 1.05) + rng.normal(0, 0.02, x.size)
            ax.semilogx(x, y_vals, "o-", ms=4, lw=1.1, label=label)
        ax.set_xlabel("concentration (nM)"); ax.set_ylabel("normalised response")
        ax.legend(fontsize=8); ax.grid(alpha=0.25, lw=0.5)
        fig.text(0.08, 0.50, textwrap.fill(
            "Figure 1. Representative titration. Points are the mean of three technical replicates; "
            "error bars are within the symbol. Curves are four-parameter logistic fits.", 92),
            size=8.4, va="top", linespacing=1.55)
        y = 0.44
        for heading in ("4. Discussion", "5. Data availability"):
            fig.text(0.08, y, heading, size=10.5, weight="bold")
            y -= 0.022
            text = textwrap.fill(SECTION_BODY[heading], 92)
            fig.text(0.08, y, text, size=8.6, va="top", linespacing=1.55)
            y -= 0.020 * (text.count("\n") + 1) + 0.035
        fig.text(0.92, 0.035, "3", size=8, ha="right", color="#999999")
        pdf.savefig(fig); plt.close(fig)
        pdf.infodict()["Title"] = title
        pdf.infodict()["Author"] = ", ".join(authors)

def paper_plain_text(title, journal, year, authors, doi, abstract):
    parts = [title, ", ".join(authors), f"{journal} ({year})", f"doi:{doi}", ""]
    for heading in SECTION_BODY:
        parts.append(heading)
        parts.append(SECTION_BODY[heading].format(abstract=abstract))
        parts.append("")
    return "\n".join(parts)

def paper_markdown(title, journal, year, authors, doi, abstract):
    return "\n".join([
        f"# {title}", "",
        f"- **Authors:** {', '.join(authors)}",
        f"- **Source:** {journal}, {year}",
        f"- **DOI:** [{doi}](https://doi.org/{doi})", "",
        "## Summary", "", textwrap.fill(abstract, 96), "",
        "## Methods at a glance", "",
        "| Step | Condition |", "| --- | --- |",
        "| Assembly | Isothermal, 25 nt overlaps, sequence verified |",
        "| Expression | BL21(DE3), 2xYT, induced OD600 0.6-0.7, 18-20 C overnight |",
        "| Capture | Ni-NTA, 40 mM imidazole wash, 250 mM elution |",
        "| Polishing | Superdex 75, 20 mM HEPES 150 mM NaCl pH 7.4 |",
        "| Quantification | A280 with calculated extinction coefficient, BCA cross-check |", "",
        "## What this means for us", "",
        "- The reported conditions are close enough to our bench setup to be used directly.",
        "- Replicate-to-replicate variation is quoted below 8%, so differences smaller than that",
        "  in our own data should not be called significant.",
        "- No serum or long-term stability data, so nothing here supports a formulation decision.", "",
        "## Open questions", "",
        "1. Does the effect hold at physiological temperature over 24 h?",
        "2. How much of the improvement survives combination with the loop substitutions?", "",
        "---", "",
        "_Synthetic sample document generated for Hikari test data._", "",
    ])

def write_papers(projects):
    kb_rows = []
    kb_index = []
    stamp = dt(2026, 6, 6, 12, 0)

    def emit(pdf_rel_dir, title, doi, journal, year, authors, abstract, wiki_status, when):
        file_name = sanitize(title)[:120] + ".pdf"
        pdf_path = os.path.join(ROOT, pdf_rel_dir, file_name)
        write_paper_pdf(pdf_path, title, journal, year, authors, doi, abstract)
        sha = hashlib.sha256(open(pdf_path, "rb").read()).hexdigest()
        key = doi.replace("/", "_")
        wiki_dir = os.path.join(ROOT, "KnowledgeBase", "papers.md", key)
        extraction_status = "ready" if wiki_status != "error" else "error"
        if wiki_status != "pending":
            wtext(os.path.join(wiki_dir, "extracted.txt"),
                  paper_plain_text(title, journal, year, authors, doi, abstract))
        if wiki_status == "ready":
            wtext(os.path.join(wiki_dir, "paper.md"),
                  paper_markdown(title, journal, year, authors, doi, abstract))
        meta = {
            "version": 1,
            "paper_id": f"paper-doi-{key}",
            "title": title,
            "doi": doi,
            "authors": authors,
            "journal": journal,
            "year": year,
            "url": f"https://doi.org/{doi}",
            "pdf_sha256": sha,
            "source_pdf_path": rel(pdf_path),
            "extraction_status": extraction_status,
            "wiki_status": wiki_status,
            "wiki_generation_method": "pdf-to-md" if wiki_status == "ready" else "",
            "extracted_text_path": f"KnowledgeBase/papers.md/{key}/extracted.txt",
            "markdown_path": f"KnowledgeBase/papers.md/{key}/paper.md" if wiki_status == "ready" else "",
            "sqlite_path": "KnowledgeBase/knowledge.index.sqlite",
            "updated_at": iso(when),
            "error": "Codex CLI timed out after 180s." if wiki_status == "error" else "",
            "warning": "",
        }
        wjson(os.path.join(wiki_dir, "meta.json"), meta)
        kb_index.append({
            "id": f"paper-sha256-{sha[:16]}",
            "doi": doi,
            "title": title,
            "pdf_sha256": sha,
            "wiki_status": wiki_status,
            "wiki_path": meta["markdown_path"],
            "extraction_status": extraction_status,
            "updated_at": iso(when),
        })
        kb_rows.append((f"paper-sha256-{sha[:16]}", doi, title, abstract, json.dumps(authors),
                        journal, year, meta["url"], sha, iso(when), iso(when), "storage_scan",
                        wiki_status, meta["markdown_path"], extraction_status, "",
                        " ".join([title, abstract, " ".join(authors), journal]).lower(),
                        rel(pdf_path), file_name))
        return rel(pdf_path)

    for index, (topic, title, doi, journal, year, authors, abstract, wiki_status) in enumerate(PAPER_DEFS):
        emit(os.path.join("Papers", topic), title, doi, journal, year, authors, abstract,
             wiki_status, stamp + timedelta(days=index * 3, hours=index))

    for index, (pkey, title, doi, journal, year, authors, abstract) in enumerate(PROJECT_PAPER_DEFS):
        project = projects[pkey]
        emit(os.path.join("Project", sanitize(project["name"]), "Papers"), title, doi, journal,
             year, authors, abstract, "ready", stamp + timedelta(days=34 + index * 2))

    wjson(os.path.join(ROOT, "KnowledgeBase", "index.json"),
          {"version": 1, "updated_at": iso(dt(2026, 8, 26, 21, 15)), "papers": kb_index})

    db_path = os.path.join(ROOT, "KnowledgeBase", "knowledge.index.sqlite")
    if os.path.exists(db_path):
        os.remove(db_path)
    db = sqlite3.connect(db_path)
    db.executescript("""
      CREATE TABLE papers (
        id TEXT PRIMARY KEY, doi TEXT UNIQUE, title TEXT, abstract TEXT, authors_json TEXT,
        journal TEXT, year TEXT, url TEXT, pdf_sha256 TEXT UNIQUE, added_at TEXT, updated_at TEXT,
        source TEXT, wiki_status TEXT, wiki_path TEXT, extraction_status TEXT, notes TEXT,
        search_text TEXT, pmid TEXT, pmcid TEXT);
      CREATE TABLE paper_locations (
        id TEXT PRIMARY KEY, paper_id TEXT NOT NULL, scope TEXT, container TEXT,
        folder_path TEXT, pdf_filename TEXT, pdf_path TEXT, discovered_at TEXT);
      CREATE TABLE paper_tags (paper_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (paper_id, tag));
      CREATE TABLE paper_links (
        from_paper_id TEXT NOT NULL, to_paper_id TEXT NOT NULL, relation TEXT,
        PRIMARY KEY (from_paper_id, to_paper_id, relation));
    """)
    for row in kb_rows:
        db.execute("INSERT INTO papers (id, doi, title, abstract, authors_json, journal, year, url,"
                   " pdf_sha256, added_at, updated_at, source, wiki_status, wiki_path,"
                   " extraction_status, notes, search_text) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   row[:17])
        pdf_rel, file_name = row[17], row[18]
        db.execute("INSERT INTO paper_locations (id, paper_id, scope, container, folder_path,"
                   " pdf_filename, pdf_path, discovered_at) VALUES (?,?,?,?,?,?,?,?)",
                   (f"loc-{row[0]}", row[0],
                    "project" if pdf_rel.startswith("Project/") else "journal_club",
                    os.path.dirname(pdf_rel).split("/")[-1], os.path.dirname(pdf_rel),
                    file_name, pdf_rel, row[9]))
        for tag in ("synthetic", os.path.dirname(pdf_rel).split("/")[-1].lower()):
            db.execute("INSERT OR IGNORE INTO paper_tags (paper_id, tag) VALUES (?, ?)", (row[0], tag))
    ids = [row[0] for row in kb_rows]
    for a, b in zip(ids, ids[1:]):
        db.execute("INSERT OR IGNORE INTO paper_links (from_paper_id, to_paper_id, relation)"
                   " VALUES (?, ?, ?)", (a, b, "related"))
    db.commit(); db.close()
    os.makedirs(os.path.join(ROOT, "KnowledgeBase", ".figures-staging"), exist_ok=True)

# ---------------------------------------------------------------- sequences
CODON = {
    "A": "GCG", "R": "CGT", "N": "AAC", "D": "GAT", "C": "TGC", "Q": "CAG", "E": "GAA",
    "G": "GGC", "H": "CAT", "I": "ATT", "L": "CTG", "K": "AAA", "M": "ATG", "F": "TTT",
    "P": "CCG", "S": "AGC", "T": "ACC", "W": "TGG", "Y": "TAT", "V": "GTG", "*": "TAA",
}

T7_PROMOTER = "TAATACGACTCACTATAGGG"
LAC_OPERATOR = "GGAATTGTGAGCGGATAACAATTCC"
RBS = "AAGGAGATATACAT"
T7_TERMINATOR = "CTAGCATAACCCCTTGGGGCCTCTAAACGGGTCTTGAGGGGTTTTTTG"
HIS_TAG = "CATCATCATCATCATCAC"
TEV_SITE = "GAAAACCTGTATTTTCAGGGC"

VHH_FRAMEWORK = ("QVQLQESGGGLVQAGGSLRLSCAASGRTFS", "WFRQAPGKEREFVA",
                 "RFTISRDNAKNTVYLQMNSLKPEDTAVYYC", "WGQGTQVTVSS")

def vhh_protein(cdr1, cdr2, cdr3):
    f1, f2, f3, f4 = VHH_FRAMEWORK
    return f1 + cdr1 + f2 + cdr2 + f3 + cdr3 + f4

def synthetic_protein(length, seed):
    """Illustrative coding sequence with a realistic amino-acid composition."""
    rng = random.Random(seed)
    weights = ("AAAAAALLLLLLLLGGGGGVVVVVSSSSSEEEEEKKKKKTTTTIIIIDDDDRRRRPPPNNNQQQFFFYYYHHMMWWCC")
    return "M" + "".join(rng.choice(weights) for _ in range(length - 1))

def reverse_translate(protein):
    return "".join(CODON[aa] for aa in protein)

def filler_dna(length, seed):
    rng = random.Random(seed)
    return "".join(rng.choice("ACGT") for _ in range(length))

def build_plasmid(name, marker, insert_blocks, backbone_seed):
    """Assemble a circular construct: backbone parts + T7 cassette + insert CDS blocks."""
    parts = []          # (label, feature_type, sequence, extra qualifiers)
    parts.append(("ori", "rep_origin", filler_dna(589, backbone_seed + 1), {}))
    marker_protein = synthetic_protein(286 if marker == "KanR" else 286, backbone_seed + 2)
    parts.append((marker, "CDS", reverse_translate(marker_protein) + "TAA",
                  {"translation": marker_protein}))
    parts.append(("lacI", "CDS", filler_dna(1083, backbone_seed + 3), {}))
    parts.append(("backbone spacer", "misc_feature", filler_dna(742, backbone_seed + 4), {}))
    parts.append(("T7 promoter", "promoter", T7_PROMOTER, {}))
    parts.append(("lac operator", "protein_bind", LAC_OPERATOR, {}))
    parts.append(("RBS", "RBS", RBS, {}))
    for label, protein, extra in insert_blocks:
        if protein is None:
            parts.append((label, "misc_feature", extra, {}))
        else:
            parts.append((label, "CDS", reverse_translate(protein), {"translation": protein}))
    parts.append(("stop", "misc_feature", "TAA", {}))
    parts.append(("T7 terminator", "terminator", T7_TERMINATOR, {}))
    parts.append(("backbone spacer 2", "misc_feature", filler_dna(431, backbone_seed + 5), {}))

    sequence = ""
    features = []
    for label, ftype, seq, qualifiers in parts:
        start = len(sequence) + 1
        sequence += seq
        features.append({"label": label, "type": ftype, "start": start,
                         "end": len(sequence), "qualifiers": qualifiers})
    return sequence, features

def genbank_text(name, sequence, features, date_text):
    lines = [
        f"LOCUS       {name[:24]:<24}{len(sequence)} bp    DNA     circular SYN {date_text}",
        f"DEFINITION  {name}",
        "ACCESSION   .",
        "VERSION     .",
        "KEYWORDS    .",
        "SOURCE      synthetic DNA construct",
        "  ORGANISM  synthetic DNA construct",
        "            .",
        "COMMENT     Synthetic construct generated for Hikari test data. Coding sequences are",
        "            illustrative and are not intended to match any deposited record.",
        "FEATURES             Location/Qualifiers",
        f"     source          1..{len(sequence)}",
        '                     /label="source"',
    ]
    for feature in features:
        lines.append(f"     {feature['type']:<16}{feature['start']}..{feature['end']}")
        lines.append(f'                     /label="{feature["label"]}"')
        translation = feature["qualifiers"].get("translation")
        if translation:
            body = f'/translation="{translation}"'
            wrapped = textwrap.wrap(body, 58)
            for chunk in wrapped:
                lines.append(f"                     {chunk}")
            lines[-1] = lines[-1]
    lines.append("ORIGIN")
    for offset in range(0, len(sequence), 60):
        chunk = sequence[offset:offset + 60].lower()
        blocks = " ".join(chunk[i:i + 10] for i in range(0, len(chunk), 10))
        lines.append(f"{offset + 1:>9} {blocks}")
    lines.append("//")
    return "\n".join(lines) + "\n"

SEQUENCE_DEFS = [
    ("pET28a-His6-TEV-VHH_CD47_C11", "KanR", 11, dt(2026, 6, 8, 16, 20),
     [("6xHis tag", None, HIS_TAG), ("TEV protease site", None, TEV_SITE),
      ("VHH CD47 C11", vhh_protein("SYAMG", "AISWSGGSTYYADSVKG", "AAGRLSYSDYRDY"), None)]),
    ("pET28a-His6-TEV-VHH_CD47_D4", "KanR", 12, dt(2026, 6, 8, 16, 40),
     [("6xHis tag", None, HIS_TAG), ("TEV protease site", None, TEV_SITE),
      ("VHH CD47 D4", vhh_protein("NYPMA", "TIYTGGGSTYYADSVKG", "NADRWGVPLSRSY"), None)]),
    ("pHEN6c-VHH_CD47_C11-HA-His6", "AmpR", 13, dt(2026, 6, 11, 11, 5),
     [("pelB leader", "MKYLLPTAAAGLLLLAAQPAMA", None),
      ("VHH CD47 C11", vhh_protein("SYAMG", "AISWSGGSTYYADSVKG", "AAGRLSYSDYRDY"), None),
      ("HA tag", "YPYDVPDYA", None), ("6xHis tag", None, HIS_TAG)]),
    ("pET21a-cpGFP-CaM-M13", "AmpR", 21, dt(2026, 6, 10, 14, 0),
     [("M13 peptide", "KRRWKKNFIAVSAANRFKKISSSGAL", None),
      ("linker 1", "LSSGT", None),
      ("cpGFP", synthetic_protein(239, 4001), None),
      ("linker 2", "GTGGS", None),
      ("calmodulin", synthetic_protein(149, 4002), None),
      ("6xHis tag", None, HIS_TAG)]),
    ("pET21a-cpGFP-CaM-M13_T203V", "AmpR", 22, dt(2026, 7, 2, 10, 30),
     [("M13 peptide", "KRRWKKNFIAVSAANRFKKISSSGAL", None),
      ("linker 1", "LSSGT", None),
      ("cpGFP T203V", synthetic_protein(239, 4003), None),
      ("linker 2", "GTGGS", None),
      ("calmodulin", synthetic_protein(149, 4002), None),
      ("6xHis tag", None, HIS_TAG)]),
    ("pET21a-cpGFP-CaM-M13_L60Q", "AmpR", 23, dt(2026, 7, 2, 10, 50),
     [("M13 peptide", "KRRWKKNFIAVSAANRFKKISSSGAL", None),
      ("linker 1 L60Q", "LSQGT", None),
      ("cpGFP", synthetic_protein(239, 4001), None),
      ("linker 2", "GTGGS", None),
      ("calmodulin", synthetic_protein(149, 4002), None),
      ("6xHis tag", None, HIS_TAG)]),
    ("pBAD33-CalB", "CmR", 31, dt(2026, 6, 24, 15, 15),
     [("CalB mature", synthetic_protein(317, 5001), None), ("6xHis tag", None, HIS_TAG)]),
    ("pBAD33-CalB_D223G_L278M", "CmR", 32, dt(2026, 7, 8, 9, 40),
     [("CalB D223G L278M", synthetic_protein(317, 5002), None), ("6xHis tag", None, HIS_TAG)]),
    ("pET28a-His6-TEV-protease-S219V", "KanR", 41, dt(2026, 5, 28, 13, 10),
     [("6xHis tag", None, HIS_TAG), ("TEV protease S219V", synthetic_protein(242, 6001), None)]),
    ("pUC19-cloning-intermediate", "AmpR", 51, dt(2026, 5, 28, 13, 30),
     [("multiple cloning site", None,
       "GAATTCGAGCTCGGTACCCGGGGATCCTCTAGAGTCGACCTGCAGGCATGCAAGCTT")]),
    ("pACYCDuet-1-GroEL-GroES", "CmR", 61, dt(2026, 6, 15, 12, 5),
     [("GroES", synthetic_protein(97, 7001), None), ("spacer", None, filler_dna(60, 7002)),
      ("GroEL", synthetic_protein(548, 7003), None)]),
]

def write_sequences():
    entries = []
    for name, marker, seed, when, blocks in SEQUENCE_DEFS:
        insert_blocks = [(label, protein, extra) for label, protein, extra in blocks]
        sequence, features = build_plasmid(name, marker, insert_blocks, seed * 97)
        entry_id = f"seq_{ms(when)}_{''.join(RNG.choice('0123456789abcdef') for _ in range(8))}"
        gbk_dir = os.path.join(ROOT, "SequenceViewer", "entries", entry_id)
        gbk_path = os.path.join(gbk_dir, f"{sanitize(name)}.gbk")
        wtext(gbk_path, genbank_text(name, sequence, features,
                                     when.strftime("%d-%b-%Y").upper()))
        entries.append({"id": entry_id, "name": name, "length": len(sequence),
                        "features": len(features) + 1, "when": when,
                        "gbk": rel(gbk_path)})
    return entries

# ---------------------------------------------------------------- assays
def well_name(row, col):
    return f"{chr(65 + row)}{col + 1}"

def fmt(value, digits=5):
    return f"{value:.{digits}g}"

def build_assay(index, name, when, project, notebook_entry, plate, sample_rows, concentrations,
                model, method, spec, series_stats, headers, unit="nM"):
    rows_n, cols_n = plate
    plate_type = "384" if rows_n == 16 else "96"
    assay_id = mkid(when)
    sample_axis_values = [""] * rows_n
    for row_index, label in enumerate(sample_rows):
        sample_axis_values[row_index] = label
    concentration_axis_values = [""] * cols_n
    for col_index, value in enumerate(concentrations):
        concentration_axis_values[col_index] = f"{value} {unit}" if value else f"0 {unit}"

    well_layout = []
    result_values = {}
    rng = np.random.default_rng(index * 7919)
    for row_index, label in enumerate(sample_rows):
        for col_index, conc in enumerate(concentrations):
            well = well_name(row_index, col_index)
            well_layout.append({"well": well, "sampleId": label,
                                "concentration": concentration_axis_values[col_index]})
            result_values[well] = fmt(model(label, conc, rng), 6)

    folder_name = folder(name, assay_id)
    target = os.path.join(ROOT, "Assays", folder_name)
    definition = {
        "id": assay_id,
        "assayNumber": f"ASY-{index:06d}",
        "name": name,
        "projectId": project["id"],
        "projectName": project["name"],
        "plateType": plate_type,
        "plateLabel": f"{plate_type} well",
        "plateRows": rows_n,
        "plateColumns": cols_n,
        "wellCount": rows_n * cols_n,
        "sampleAxis": "row",
        "concentrationAxis": "column",
        "sampleAxisValues": sample_axis_values,
        "concentrationAxisValues": concentration_axis_values,
        "manualWellOverrides": {},
        "suppressedWells": [],
        "notebookEntryId": notebook_entry["id"] if notebook_entry else "",
        "notebookEntryProtocolName": notebook_entry["protocolName"] if notebook_entry else "",
        "notebookEntryType": "biology" if notebook_entry else "",
        "serialDilution": {
            "volumePerWellUl": "100",
            "stockConcentrations": {label: "10000" for label in sample_rows},
        },
        "serialDilutionSummary": {
            "concentrationAxisName": "Column",
            "volumePerWellUl": 100,
            "feedbackMessages": [],
            "initialDilutionRows": [],
            "followingDilutionRows": [],
            "followingRowsAreShared": True,
            "hasValidPlans": True,
        },
        "wellLayout": well_layout,
        "resultAttachments": [],
        "chartStyle": None,
        "transformSpec": None,
        "updatedAt": iso(when),
    }
    chart_path = os.path.join(target, "analysis-chart.svg")
    write_assay_chart(chart_path, name, sample_rows, concentrations, model, unit)
    latest = {
        "method": method,
        "spec": spec,
        "methodLabel": ASSAY_METHOD_LABELS[method],
        "summary": series_stats["summary"],
        "headers": headers,
        "rows": series_stats["rows"],
        "chartDataUrl": "",
        "analyzedAt": iso(when + timedelta(hours=2)),
    }
    wjson(os.path.join(target, "assay-definition.json"), definition)
    wjson(os.path.join(target, "analysis-result.json"), {
        "assayId": assay_id,
        "resultValues": result_values,
        "resultAttachments": [],
        "latestAnalysis": latest,
        "updatedAt": iso(when + timedelta(hours=2)),
    })
    record = dict(definition)
    record.update({
        "resultValues": result_values,
        "latestAnalysis": latest,
        "storageFolder": target,
        "definitionJsonPath": os.path.join(target, "assay-definition.json"),
        "definitionJsonRelativePath": f"Assays/{folder_name}/assay-definition.json",
        "analysisResultPath": os.path.join(target, "analysis-result.json"),
        "analysisResultRelativePath": f"Assays/{folder_name}/analysis-result.json",
        "analysisChartRelativePath": f"Assays/{folder_name}/analysis-chart.svg",
    })
    return record

ASSAY_METHOD_LABELS = {
    "ic50": "Sigmoidal 4PL (IC50) · grouped by auto",
    "ec50": "Sigmoidal 4PL (EC50) · grouped by auto",
    "grouped_summary": "Summary statistics · grouped by auto",
    "row_summary": "Summary statistics · grouped by row",
    "standard_curve_4pl_log_concentration": "Sigmoidal 4PL standard curve · grouped by auto",
}

def write_assay_chart(path, title, sample_rows, concentrations, model, unit):
    rng = np.random.default_rng(7)
    fig, ax = plt.subplots(figsize=(5.6, 3.8))
    for label in dict.fromkeys(sample_rows):
        xs = [c for c in concentrations if c > 0]
        ys = [float(model(label, c, rng)) for c in xs]
        ax.semilogx(xs, ys, "o-", ms=4, lw=1.2, label=label)
    ax.set_xlabel(f"concentration ({unit})")
    ax.set_ylabel("response")
    ax.set_title(title, fontsize=10)
    ax.grid(alpha=0.25, lw=0.5)
    ax.legend(fontsize=7, ncol=2)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fig.savefig(path, format="svg", bbox_inches="tight")
    plt.close(fig)

def write_assays(projects, notebook_by_experiment):
    assays = []

    # 1) CD47 blockade IC50, 96 well
    ic50s = {"VHH C11": 41.0, "VHH D4": 380.0, "Isotype VHH": 1e9}
    def blockade(label, conc, rng):
        x = max(conc, 1e-3)
        return four_pl(x, 1180 if label == "VHH C11" else (4620 if label == "VHH D4" else 17960),
                       18420, ic50s[label], 1.05) + rng.normal(0, 240)
    conc_series = [3000, 1000, 333.3, 111.1, 37.04, 12.35, 4.115, 1.372, 0.4572, 0.1524, 0.0508, 0]
    assays.append(build_assay(
        1, "CD47 SIRPa blockade IC50", dt(2026, 6, 24, 15, 40), projects["cd47"],
        notebook_by_experiment.get("CD47/SIRPalpha blocking IC50 of C11 and D4"),
        (8, 12), ["VHH C11", "VHH C11", "VHH D4", "VHH D4", "Isotype VHH", "Isotype VHH"],
        conc_series, blockade, "ic50",
        {"groupBy": "auto", "xAxis": "concentration", "analysis": "sigmoidal",
         "xTransform": "log10", "polyOrder": 2, "asymmetric": False, "subtotals": False,
         "errorBars": True},
        {"summary": "Sigmoidal 4PL fitted for 3 series (grouped by Sample ID) using Concentration as X.",
         "rows": [
             ["Isotype VHH", 22, "Sigmoidal 4PL", "IC50", "-", "0.0412", "318.4",
              "y = bottom + (top-bottom)/(1 + exp(hill*(mid-x)))",
              "top=18420; bottom=17960; mid=9.02; hill=-1.01"],
             ["VHH C11", 22, "Sigmoidal 4PL", "IC50", "41.213", "0.99612", "268.71",
              "y = bottom + (top-bottom)/(1 + exp(hill*(mid-x)))",
              "top=18431; bottom=1174.2; mid=1.6151; hill=-1.0492"],
             ["VHH D4", 22, "Sigmoidal 4PL", "IC50", "379.62", "0.98817", "402.55",
              "y = bottom + (top-bottom)/(1 + exp(hill*(mid-x)))",
              "top=18388; bottom=4643.8; mid=2.5794; hill=-0.9241"],
         ]},
        ["Sample ID", "Points", "Model", "Potency", "x50", "R²", "RMSE", "Equation", "Parameters"]))

    # 2) cpGFP calcium titration EC50, 96 well
    params = {"parent": (285, 4.8, 2.1), "L58G": (410, 3.2, 1.8), "L60Q": (262, 5.1, 2.2),
              "L60S": (318, 4.4, 2.0), "N62D": (900, 1.3, 1.2), "T203V": (204, 9.6, 2.4),
              "T203S": (241, 6.2, 2.2)}
    def calcium(label, conc, rng):
        kd, fmax, hill = params[label]
        x = max(conc, 1e-3)
        return 1 + (fmax - 1) * x ** hill / (kd ** hill + x ** hill) + rng.normal(0, 0.04)
    ca_series = [39000, 12000, 3900, 1200, 390, 120, 39, 12, 3.9, 1.2, 0.39, 0]
    assays.append(build_assay(
        2, "cpGFP variant calcium titration", dt(2026, 6, 19, 18, 10), projects["cpgfp"],
        notebook_by_experiment.get("Calcium titration of the 7-variant panel"),
        (8, 12), list(params.keys()), ca_series, calcium, "ec50",
        {"groupBy": "auto", "xAxis": "concentration", "analysis": "sigmoidal",
         "xTransform": "log10", "polyOrder": 2, "asymmetric": False, "subtotals": False,
         "errorBars": True},
        {"summary": "Sigmoidal 4PL fitted for 7 series (grouped by Sample ID) using Concentration as X.",
         "rows": [
             ["L58G", 11, "Sigmoidal 4PL", "EC50", "409.8", "0.99341", "0.0412", "y = bottom + (top-bottom)/(1 + exp(hill*(mid-x)))", "top=3.198; bottom=1.004; mid=2.6125; hill=1.802"],
             ["L60Q", 11, "Sigmoidal 4PL", "EC50", "261.4", "0.99518", "0.0448", "y = bottom + (top-bottom)/(1 + exp(hill*(mid-x)))", "top=5.106; bottom=0.998; mid=2.4172; hill=2.191"],
             ["L60S", 11, "Sigmoidal 4PL", "EC50", "317.6", "0.99402", "0.0431", "y = bottom + (top-bottom)/(1 + exp(hill*(mid-x)))", "top=4.412; bottom=1.001; mid=2.5019; hill=2.013"],
             ["N62D", 11, "Sigmoidal 4PL", "EC50", "-", "0.6124", "0.0392", "y = bottom + (top-bottom)/(1 + exp(hill*(mid-x)))", "top=1.311; bottom=0.996; mid=2.954; hill=1.184"],
             ["T203S", 11, "Sigmoidal 4PL", "EC50", "240.8", "0.99604", "0.0455", "y = bottom + (top-bottom)/(1 + exp(hill*(mid-x)))", "top=6.214; bottom=1.002; mid=2.3818; hill=2.208"],
             ["T203V", 11, "Sigmoidal 4PL", "EC50", "203.7", "0.99718", "0.0521", "y = bottom + (top-bottom)/(1 + exp(hill*(mid-x)))", "top=9.617; bottom=0.999; mid=2.3092; hill=2.401"],
             ["parent", 11, "Sigmoidal 4PL", "EC50", "284.6", "0.99562", "0.0437", "y = bottom + (top-bottom)/(1 + exp(hill*(mid-x)))", "top=4.803; bottom=1.000; mid=2.4542; hill=2.104"],
         ]},
        ["Sample ID", "Points", "Model", "Potency", "x50", "R²", "RMSE", "Equation", "Parameters"]))

    # 3) CalB primary activity screen, 96 well, summary statistics
    rates = {"WT": 182, "L1-07": 199, "L1-14": 268, "L1-19": 254, "L2-31": 301,
             "L2-36": 288, "L2-52": 246, "empty vector": 8}
    def lipase(label, conc, rng):
        return max(0.0, rates[label] * (1 + rng.normal(0, 0.068)))
    assays.append(build_assay(
        3, "CalB library primary activity screen", dt(2026, 6, 29, 13, 20), projects["calb"],
        notebook_by_experiment.get("Primary activity screen, 88 library clones"),
        (8, 12), list(rates.keys()), [10] * 12, lipase, "grouped_summary",
        {"groupBy": "auto", "xAxis": "auto", "analysis": "summary", "xTransform": "none",
         "polyOrder": 2, "asymmetric": False, "subtotals": False, "errorBars": True},
        {"summary": "Summary statistics for 8 group(s), grouped by Sample ID. Rows: 8.",
         "rows": [
             ["L1-07", 12, "198.4", "13.1", "179.2", "221.0"],
             ["L1-14", 12, "267.1", "17.9", "241.3", "297.6"],
             ["L1-19", 12, "253.8", "16.4", "228.9", "281.4"],
             ["L2-31", 12, "300.6", "19.8", "272.1", "334.5"],
             ["L2-36", 12, "287.4", "18.6", "259.0", "318.2"],
             ["L2-52", 12, "245.9", "16.1", "221.4", "272.8"],
             ["WT", 12, "181.6", "12.4", "163.9", "202.7"],
             ["empty vector", 12, "8.0", "0.6", "7.1", "9.0"],
         ]},
        ["Sample ID", "N", "Mean", "SD", "Min", "Max"], unit="mM"))

    # 4) DSF melting temperature, 384 well
    tms = {"WT": 52.8, "D223G": 56.1, "L278M": 55.2, "D223G/L278M": 59.2, "S150T": 55.9,
           "buffer blank": 0.0}
    def melt(label, conc, rng):
        if label == "buffer blank":
            return abs(rng.normal(0.4, 0.05))
        return tms[label] + rng.normal(0, 0.25)
    assays.append(build_assay(
        4, "CalB variant thermal shift", dt(2026, 7, 18, 17, 55), projects["calb"],
        notebook_by_experiment.get("Thermal shift ranking of round-1 variants"),
        (16, 24), list(tms.keys()), [0.2] * 24, melt, "row_summary",
        {"groupBy": "row", "xAxis": "auto", "analysis": "summary", "xTransform": "none",
         "polyOrder": 2, "asymmetric": False, "subtotals": False, "errorBars": True},
        {"summary": "Summary statistics for 6 group(s), grouped by Row. Rows: 6.",
         "rows": [
             ["A", 24, "52.81", "0.24", "52.34", "53.29"],
             ["B", 24, "56.09", "0.26", "55.61", "56.58"],
             ["C", 24, "55.18", "0.23", "54.72", "55.64"],
             ["D", 24, "59.21", "0.22", "58.79", "59.68"],
             ["E", 24, "55.92", "0.27", "55.38", "56.44"],
             ["F", 24, "0.40", "0.05", "0.31", "0.51"],
         ]},
        ["Row", "N", "Mean", "SD", "Min", "Max"], unit="mg/mL"))

    # 5) BCA standard curve, 96 well
    def bca(label, conc, rng):
        return 0.06 + 1.62 * conc / (conc + 620) + rng.normal(0, 0.006)
    bca_series = [2000, 1000, 500, 250, 125, 62.5, 31.25, 15.6, 7.8, 3.9, 1.95, 0]
    assays.append(build_assay(
        5, "BCA standard curve 2026-06-19", dt(2026, 6, 19, 10, 5), projects["ops"],
        notebook_by_experiment.get("Quantification of the C11 and D4 SEC pools"),
        (8, 12), ["BSA std", "BSA std", "BSA std"], bca_series, bca,
        "standard_curve_4pl_log_concentration",
        {"groupBy": "auto", "xAxis": "concentration", "analysis": "sigmoidal",
         "xTransform": "log10", "polyOrder": 2, "asymmetric": False, "subtotals": False,
         "errorBars": True},
        {"summary": "Sigmoidal 4PL fitted for 1 series (grouped by Sample ID) using Concentration as X.",
         "rows": [
             ["BSA std", 33, "Sigmoidal 4PL", "EC50", "619.4", "0.99913", "0.00612",
              "y = bottom + (top-bottom)/(1 + exp(hill*(mid-x)))",
              "top=1.6812; bottom=0.0594; mid=2.7918; hill=1.0043"],
         ]},
        ["Sample ID", "Points", "Model", "Potency", "x50", "R²", "RMSE", "Equation", "Parameters"],
        unit="ug/mL"))
    return assays

# ---------------------------------------------------------------- gels
from PIL import Image

def render_gel_image(path, width, height, lanes, seed):
    """lanes: list of [(y_center, intensity, thickness), ...] per lane."""
    rng = np.random.default_rng(seed)
    field = np.zeros((height, width), dtype=float)
    lane_width = width / len(lanes)
    ys = np.arange(height)[:, None]
    xs = np.arange(width)[None, :]
    for lane_index, bands in enumerate(lanes):
        cx = (lane_index + 0.5) * lane_width
        smile = 2.4 * ((cx / width) - 0.5) ** 2 * height * 0.02
        lane_profile = np.exp(-((xs - cx) ** 2) / (2 * (lane_width * 0.28) ** 2))
        for y_center, intensity, thickness in bands:
            band = np.exp(-((ys - (y_center + smile)) ** 2) / (2 * thickness ** 2))
            field += intensity * band * lane_profile
    field += rng.normal(0, 0.012, field.shape)
    field += 0.05 * np.exp(-((ys - height * 0.5) ** 2) / (2 * (height * 0.9) ** 2))
    field = np.clip(field, 0, 1.6)
    grey = np.clip(244 - field * 226, 4, 255).astype(np.uint8)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.fromarray(grey, mode="L").save(path)
    return Image.fromarray(grey, mode="L")

LADDER_PROTEIN = [250, 150, 100, 75, 50, 37, 25, 20, 15, 10]
LADDER_DNA = [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 500]

def mw_to_y(mw, height, top_mw, bottom_mw):
    span = math.log10(top_mw) - math.log10(bottom_mw)
    frac = (math.log10(top_mw) - math.log10(mw)) / span
    return 0.08 * height + frac * 0.84 * height

GEL_DEFS = [
    ("VHH C11 IMAC fractions", "sds-page", "vhh-c11-imac.tif", "cd47", dt(2026, 6, 18, 18, 5),
     ["Ladder", "Periplasmic load", "Flow-through", "Wash 40 mM", "E1", "E2", "E3", "E4", "E5", "SEC pool"],
     [[(15.4, 1.0)], [(15.4, 0.34), (62, 0.5), (38, 0.42), (28, 0.3)],
      [(62, 0.48), (38, 0.4), (28, 0.28)], [(15.4, 0.16), (38, 0.12)],
      [(15.4, 0.42), (38, 0.08)], [(15.4, 0.92)], [(15.4, 1.0)], [(15.4, 0.78)],
      [(15.4, 0.44)], [(15.4, 0.96)]]),
    ("Colony PCR screen, CalB library", "agarose", "calb-colony-pcr.tif", "calb", dt(2026, 6, 26, 16, 40),
     ["Ladder", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "c10", "c11", "c12"],
     [[(1000, 1.0)]] + [([(980, 0.85)] if index % 5 else [(980, 0.1), (320, 0.4)])
                        for index in range(12)]),
    ("cpGFP variant panel purity", "sds-page", "cpgfp-panel.tif", "cpgfp", dt(2026, 6, 20, 12, 30),
     ["Ladder", "parent", "L58G", "L60Q", "L60S", "N62D", "T203V", "T203S"],
     [[(47, 1.0)], [(47, 0.94)], [(47, 0.88)], [(47, 0.97)], [(47, 0.9)],
      [(47, 0.55), (32, 0.62)], [(47, 0.98)], [(47, 0.9), (32, 0.16)]]),
    ("CalB DSF panel purity", "sds-page", "calb-dsf-panel.tif", "calb", dt(2026, 7, 18, 18, 20),
     ["Ladder", "WT", "D223G", "L278M", "D223G/L278M", "S150T"],
     [[(33, 1.0)], [(33, 0.93), (66, 0.12)], [(33, 0.95)], [(33, 0.94)],
      [(33, 0.96)], [(33, 0.92), (66, 0.1)]]),
]

def write_gels(projects, notebook_by_experiment):
    records = []
    for index, (name, analysis_type, image_name, pkey, when, lane_labels, lane_bands) in enumerate(GEL_DEFS):
        width, height = 720, 480
        is_dna = analysis_type == "agarose"
        ladder = LADDER_DNA if is_dna else LADDER_PROTEIN
        top_mw, bottom_mw = ladder[0] * 1.3, ladder[-1] * 0.7
        pixel_lanes = []
        for lane_index, bands in enumerate(lane_bands):
            entries = []
            if lane_index == 0:
                for mw in ladder:
                    entries.append((mw_to_y(mw, height, top_mw, bottom_mw), 0.85, 3.4))
            else:
                for mw, intensity in bands:
                    entries.append((mw_to_y(mw, height, top_mw, bottom_mw), intensity, 4.2))
            pixel_lanes.append(entries)
        gel_id = mkid(when)
        target = os.path.join(ROOT, "Gels", folder(name, gel_id))
        source_path = os.path.join(target, "source.png")
        image = render_gel_image(source_path, width, height, pixel_lanes, 3000 + index)
        image.resize((width // 3, height // 3)).save(os.path.join(target, "preview.png"))

        lane_width = width / len(pixel_lanes)
        dividers = [int(lane_width * (i + 1)) for i in range(len(pixel_lanes) - 1)]
        lanes = []
        band_groups = {}
        for lane_index, entries in enumerate(pixel_lanes, start=1):
            x_start = int((lane_index - 1) * lane_width)
            x_end = int(lane_index * lane_width)
            bands = []
            for band_index, (y_center, intensity, thickness) in enumerate(entries, start=1):
                top = int(y_center - thickness * 1.6)
                bottom = int(y_center + thickness * 1.6)
                mw = None
                if lane_index == 1:
                    mw = ladder[band_index - 1]
                else:
                    mw = round(10 ** (math.log10(top_mw) - ((y_center - 0.08 * height) /
                                                            (0.84 * height)) *
                                      (math.log10(top_mw) - math.log10(bottom_mw))), 2)
                bands.append({
                    "bandIndex": band_index,
                    "top": top, "bottom": bottom, "pixelY": int(y_center),
                    "thickness": bottom - top,
                    "estimatedMw": mw,
                    "rawIntensity": round(intensity * 84.5, 4),
                    "correctedIntensity": round(intensity * 81.2, 4),
                    "snr": round(3.2 + intensity * 5.4, 3),
                })
                band_groups.setdefault(round(math.log10(max(mw, 1)), 1), []).append(
                    {"laneIndex": lane_index, "bandIndex": band_index})
            strongest = max(entries, key=lambda item: item[1]) if entries else None
            lanes.append({
                "laneIndex": lane_index,
                "label": lane_labels[lane_index - 1],
                "xStart": x_start,
                "xEnd": x_end,
                "vertices": {
                    "laneIndex": lane_index,
                    "topLeft": {"x": x_start, "y": 0}, "topRight": {"x": x_end, "y": 0},
                    "bottomRight": {"x": x_end, "y": height - 1},
                    "bottomLeft": {"x": x_start, "y": height - 1},
                },
                "totalBandIntensity": round(sum(band["correctedIntensity"] for band in bands), 4),
                "targetBandIntensity": round(max((band["correctedIntensity"] for band in bands),
                                                 default=0.0), 4),
                "rowActivityFraction": round(len(bands) / 12.0, 4),
                "confidence": {
                    "score": round(0.62 + 0.3 * (strongest[1] if strongest else 0), 4),
                    "label": "high" if strongest and strongest[1] > 0.7 else "medium",
                    "factors": {"sharpness": 0.71, "snr": 0.68, "ladderFit": 0.92,
                                "saturation": 1, "bandCount": min(1.0, len(bands) / 4)},
                },
                "interpretation": {
                    "notes": ["Single dominant band detected." if len(bands) == 1
                              else f"{len(bands)} bands resolved."],
                    "warnings": [] if len(bands) < 6 else ["Dense lane, band calls may merge."],
                    "strongBandCount": sum(1 for _, intensity, _ in entries if intensity > 0.5),
                    "smearDetected": False,
                },
                "targetBand": bands[0] if bands else None,
                "bands": bands,
            })

        overrides = {
            "laneSegmentation": {
                "gelLeft": 0, "gelRight": width - 1, "dividers": dividers, "dividerDone": True,
                "bandTop": None, "bandBottom": None, "perLaneBandEnabled": True,
                "laneBandWindows": [{"laneIndex": lane["laneIndex"],
                                     "bandTop": lane["bands"][0]["top"] if lane["bands"] else 0,
                                     "bandBottom": lane["bands"][0]["bottom"] if lane["bands"] else 0}
                                    for lane in lanes],
                "laneVertices": [lane["vertices"] for lane in lanes],
            },
            "addedBands": [],
            "ladderLane": 1,
            "ladderBands": [{"mw": mw, "pixelY": int(mw_to_y(mw, height, top_mw, bottom_mw))}
                            for mw in ladder],
            "ladderBandsDone": True,
            "laneTable": {"rows": [{"laneIndex": lane["laneIndex"], "label": lane["label"],
                                    "sampleId": lane["label"]} for lane in lanes]},
        }
        parameters = {
            "analysisMode": "manual",
            "cropApplied": True,
            "ladderStandards": ladder,
            "ladderLane": 1,
            "normalization": "none",
            "enhancement": {"denoiseStrength": 0, "contrastBoost": 118},
            "ladderBands": overrides["ladderBands"],
            "manualOverrides": overrides,
        }
        entry = notebook_by_experiment.get(GEL_NOTEBOOK_LINKS.get(name, ""))
        record = {
            "id": gel_id,
            "name": name,
            "projectId": projects[pkey]["id"],
            "projectName": projects[pkey]["name"],
            "notebookEntryId": entry["id"] if entry else "",
            "notebookEntryProtocolName": entry["protocolName"] if entry else "",
            "notebookEntryType": "biology" if entry else "",
            "imageName": image_name,
            "analysisType": analysis_type,
            "parameters": parameters,
            "manualOverrides": overrides,
            "updatedAt": iso(when),
            "storageFolder": target,
            "sourceImageRelativePath": rel(source_path),
            "previewImageRelativePath": rel(os.path.join(target, "preview.png")),
            "analysisResultRelativePath": rel(os.path.join(target, "analysis-result.json")),
        }
        wjson(os.path.join(target, "gel-record.json"), record)
        wjson(os.path.join(target, "analysis-result.json"), {
            "generatedAt": iso(when + timedelta(minutes=25)),
            "image": {"name": image_name, "width": width, "height": height,
                      "tiffPage": 1, "tiffPageCount": 1},
            "analysisType": analysis_type,
            "preprocessing": {
                "grayscale": True, "clahe": True, "backend": "js", "denoiseStrength": 0,
                "contrastBoost": 118, "claheClipFactor": 3.2, "denoiseSigma": 0,
                "backgroundSigma": 24, "pipeline": "denoise -> flat-field -> contrast",
                "quantificationSignal": "raw-gray", "gelPolarity": "dark-on-light",
                "manualOverridesSummary": {
                    "laneSegmentationLeft": 0, "laneSegmentationRight": width - 1,
                    "laneSegmentationDividers": len(dividers),
                    "laneSegmentationBandTop": None, "laneSegmentationBandBottom": None,
                    "laneSegmentationBandMode": "per-lane",
                    "laneSegmentationLaneBandWindows": len(lanes),
                    "laneSegmentationLaneVertices": len(lanes),
                    "addedBands": 0, "ladderLaneOverride": 1,
                    "ladderBands": len(ladder), "ladderBandsDone": True,
                },
            },
            "parameters": parameters,
            "laneDetection": {"laneCount": len(lanes), "profileThreshold": 0.18},
            "calibration": {"ok": True, "ladderLane": 1,
                            "reason": "", "rSquared": 0.9962,
                            "model": "log10(MW) = a + b * migration"},
            "confidence": {"score": 0.84, "label": "high"},
            "bandGroups": [
                {"id": f"group-{group_index + 1}",
                 "label": f"Band Group {group_index + 1}",
                 "approxMw": round(10 ** key, 1),
                 "members": members}
                for group_index, (key, members) in enumerate(sorted(band_groups.items(), reverse=True))
            ],
            "lanes": lanes,
            "warnings": [],
        })
        records.append(record)
    return records

GEL_NOTEBOOK_LINKS = {
    "VHH C11 IMAC fractions": "SDS-PAGE of C11 IMAC and SEC fractions",
    "Colony PCR screen, CalB library": "Reference 1% agarose gel for the CalB library QC",
    "cpGFP variant panel purity": "Purity check of the cpGFP variant panel",
    "CalB DSF panel purity": "Purity of the CalB DSF panel",
}

# ---------------------------------------------------------------- workflows
WORKFLOW_TEMPLATES = [
    ("VHH Expression and Purification", dt(2026, 6, 12, 9, 0),
     "Standard route from a verified expression clone to a quantified, polished VHH prep.",
     ["transform_hs", "periplasmic", "ninta", "sec", "sdspage", "a280"],
     [(0, 1), (1, 2), (2, 3), (3, 4), (3, 5)]),
    ("Clone to Screen", dt(2026, 6, 13, 10, 30),
     "Amplify, assemble, transform and screen a construct or small library.",
     ["pcr_q5", "dpni_gibson", "transform_electro", "pcr_colony", "miniprep"],
     [(0, 1), (1, 2), (2, 3), (3, 4)]),
    ("Variant Stability Triage", dt(2026, 7, 10, 14, 0),
     "Express, purify and rank a small variant panel by thermal stability.",
     ["iptg", "ninta", "tsa", "sdspage"],
     [(0, 1), (1, 2), (1, 3)]),
]

WORKFLOW_RUNS = [
    ("VHH Expression and Purification", "VHH C11 prep June", "cd47", dt(2026, 6, 16, 9, 0),
     ["completed", "completed", "completed", "completed", "completed", "completed"]),
    ("VHH Expression and Purification", "VHH D4 prep July", "cd47", dt(2026, 7, 1, 8, 15),
     ["completed", "completed", "completed", "in_progress", "not_done", "not_done"]),
    ("Clone to Screen", "cpGFP linker library", "cpgfp", dt(2026, 6, 11, 9, 45),
     ["completed", "completed", "completed", "completed", "completed"]),
    ("Clone to Screen", "CalB NNK library round 1", "calb", dt(2026, 6, 25, 10, 0),
     ["completed", "completed", "completed", "in_progress", "not_done"]),
    ("Variant Stability Triage", "CalB round-1 hits", "calb", dt(2026, 7, 15, 9, 0),
     ["completed", "completed", "completed", "completed"]),
]

def write_workflows(projects):
    templates = {}
    for name, created, description, protocol_keys, edges in WORKFLOW_TEMPLATES:
        template_id = mkid(created)
        blocks = []
        for index, key in enumerate(protocol_keys):
            blocks.append({
                "id": f"{ms(created)}-{''.join(RNG.choice('0123456789abcdef') for _ in range(13))}",
                "type": "protocol",
                "protocolId": PROTOCOLS[key]["id"],
                "text": "",
                "assigneeId": "",
                "x": 40 + (index % 3) * 300,
                "y": 90 + (index // 3) * 210,
            })
        links = [{"id": f"{ms(created)}-{''.join(RNG.choice('0123456789abcdef') for _ in range(13))}",
                  "fromBlockId": blocks[a]["id"], "toBlockId": blocks[b]["id"]} for a, b in edges]
        template = {"id": template_id, "name": name, "description": description,
                    "projectId": "", "blocks": blocks, "links": links,
                    "createdAt": iso(created), "updatedAt": iso(created)}
        templates[name] = {"record": template, "protocolKeys": protocol_keys, "edges": edges}
        wjson(os.path.join(ROOT, "Workflow", folder(name, template_id), "template.json"),
              {"exportedAt": SCHEMA_STAMP, "template": template})

    workflows = []
    workflow_notebook_entries = []
    for template_name, run_name, pkey, started, statuses in WORKFLOW_RUNS:
        info = templates[template_name]
        template = info["record"]
        project = projects[pkey]
        run_id = mkid(started)
        blocks = []
        id_map = {}
        for index, block in enumerate(template["blocks"]):
            new_id = f"{ms(started)}-{''.join(RNG.choice('0123456789abcdef') for _ in range(13))}"
            id_map[block["id"]] = new_id
            blocks.append({**block, "id": new_id})
        links = [{"id": f"{ms(started)}-{''.join(RNG.choice('0123456789abcdef') for _ in range(13))}",
                  "fromBlockId": id_map[link["fromBlockId"]],
                  "toBlockId": id_map[link["toBlockId"]]} for link in template["links"]]

        run_folder = os.path.join(ROOT, "Workflow", folder(template_name, template["id"]),
                                  folder(run_name, run_id))
        entry_folder_id = f"{ms(started)}-{''.join(RNG.choice('0123456789abcdef') for _ in range(13))}"
        notebook_root = os.path.join(run_folder, "Notebook", folder(run_name, entry_folder_id))

        step_states = {}
        notebook_ids = []
        for index, (block, status) in enumerate(zip(blocks, statuses)):
            protocol = PROTOCOLS[info["protocolKeys"][index]]
            when = started + timedelta(days=index, hours=index * 2)
            page_id = mkid(when)
            notebook_ids.append(page_id)
            result = ("" if status == "not_done" else
                      f'{protocol["name"]} step of {run_name}: '
                      + ("completed as written, no deviations recorded."
                         if status == "completed" else "started, waiting on the overnight step."))
            entry = {
                "id": page_id,
                "notebookType": "biology",
                "projectId": project["id"],
                "projectName": project["name"],
                "protocolId": protocol["id"],
                "protocolName": protocol["name"],
                "experimentName": f'{run_name} · {protocol["name"]}',
                "protocolSnapshot": protocol_snapshot(protocol),
                "values": protocol_values(protocol) if status != "not_done" else {},
                "result": result,
                "resultFiles": [],
                "resultFileRecords": [],
                "resultFileAddresses": [],
                "notebookState": "executed" if status == "completed" else "draft",
                "executedAt": iso(when + timedelta(hours=5)) if status == "completed" else "",
                "agentDraftStatus": "",
                "agentDraftMeta": {"workflowId": run_id, "proposalId": ""},
                "workflowId": run_id,
                "createdAt": iso(when),
                "updatedAt": iso(when + timedelta(hours=6)),
                "storageFolder": os.path.join(notebook_root, f"Notebook_Page__{page_id}"),
            }
            wjson(os.path.join(notebook_root, f"Notebook_Page__{page_id}", "page.json"),
                  envelope("hikari_notebook_pages", "notebookEntry", entry))
            workflow_notebook_entries.append(entry)
            step_states[block["id"]] = {
                "status": status,
                "values": entry["values"],
                "result": result,
                "resultFiles": [],
                "resultFileRecords": [],
                "notebookEntryId": page_id,
                "assayIds": [],
                "gelAnalysisIds": [],
                "completedAt": iso(when + timedelta(hours=5)) if status == "completed" else "",
                "updatedAt": iso(when + timedelta(hours=6)),
            }

        completed = sum(1 for status in statuses if status == "completed")
        workflow = {
            "id": run_id,
            "templateId": template["id"],
            "name": run_name,
            "description": f'Run of "{template_name}" for {project["name"]}.',
            "projectId": project["id"],
            "notebookEntryIds": notebook_ids,
            "blocks": blocks,
            "links": links,
            "entries": [{
                "id": entry_folder_id,
                "name": run_name,
                "notes": "",
                "activeBranchRootIds": [blocks[0]["id"]],
                "stepStates": step_states,
            }],
            "createdAt": iso(started),
            "updatedAt": iso(started + timedelta(days=len(statuses), hours=6)),
        }
        wjson(os.path.join(run_folder, "workflow.json"),
              {"exportedAt": SCHEMA_STAMP, "template": template, "workflow": workflow})
        wjson(os.path.join(run_folder, "RelatedPapers", "related-papers.json"),
              {"exportedAt": SCHEMA_STAMP, "workflowId": run_id, "papers": [],
               "paperExperimentLinks": []})
        os.makedirs(os.path.join(run_folder, "Results"), exist_ok=True)
        wtext(os.path.join(run_folder, "MEMORY.md"), "\n".join([
            "# Workflow Memory", "",
            f"Name: {run_name}", f"ID: {run_id}", f"Template: {template_name}",
            f'Template ID: {template["id"]}', f'Project: {project["name"]}',
            f'Project ID: {project["id"]}', f'Description: {workflow["description"]}',
            f'Created: {workflow["createdAt"]}', f'Updated: {workflow["updatedAt"]}', "",
            "## Progress",
            f"- Overall status: {'completed' if completed == len(statuses) else 'in progress'}",
            f"- Completion: {round(100 * completed / len(statuses))}%",
            f"- Steps completed: {completed} / {len(statuses)}",
            "- Failed steps: 0",
            f"- Pending steps: {len(statuses) - completed}",
            "- Workflow entries: 1",
            f"- Workflow blocks: {len(blocks)}",
            f"- Linked notebook pages: {len(notebook_ids)}",
            "- Related papers: 0",
            "- Result files: 0", "",
            "## Notes",
            "- Auto-generated from Hikari workflow storage metadata.",
            "- Update the workflow in the app to refresh this summary.", "",
        ]))
        workflows.append({"workflow": workflow,
                          "relativeFolderPath": rel(run_folder).split("Workflow/", 1)[1]})

    db_path = os.path.join(ROOT, "Workflow", "workflow-status.sqlite")
    if os.path.exists(db_path):
        os.remove(db_path)
    db = sqlite3.connect(db_path)
    db.executescript("""
      CREATE TABLE workflow_templates (id TEXT PRIMARY KEY, raw_json TEXT);
      CREATE TABLE workflow_runs (id TEXT PRIMARY KEY, relative_folder_path TEXT, raw_json TEXT);
    """)
    db.executemany("INSERT INTO workflow_templates (id, raw_json) VALUES (?, ?)",
                   [(info["record"]["id"], json.dumps(info["record"])) for info in templates.values()])
    db.executemany("INSERT INTO workflow_runs (id, relative_folder_path, raw_json) VALUES (?, ?, ?)",
                   [(row["workflow"]["id"], row["relativeFolderPath"], json.dumps(row["workflow"]))
                    for row in workflows])
    db.commit(); db.close()
    return [info["record"] for info in templates.values()], \
           [row["workflow"] for row in workflows], workflow_notebook_entries

# ---------------------------------------------------------------- chat log
CHAT_DEFS = [
    ("cd47", dt(2026, 6, 17, 20, 12),
     "Our first Ni-NTA run on the VHH periplasmic extract lost about a quarter of the product in the "
     "40 mM wash. Is that expected, and what would you change?",
     "A 40 mM imidazole wash is on the aggressive side for a single-domain binder with an N-terminal "
     "His6 tag. Two things are worth separating:\n\n"
     "1. Genuine weak binding. Small proteins present the tag close to the folded core, so the "
     "effective affinity for the resin is lower than for a long linker construct. Dropping the wash "
     "to 25-30 mM usually recovers most of it.\n"
     "2. Overloading. Your load was 84 mg of total protein onto 5 mL of resin, which is near the "
     "static capacity once host contaminants are counted.\n\n"
     "Suggested next run: keep the 20 mM equilibration, wash at 25 mM, and split the wash into two "
     "5 CV steps so you can see on the gel where the loss happens.",
     "protocol_to_notebook"),
    ("cd47", dt(2026, 6, 25, 9, 40),
     "Summarise the blocking assay result and tell me whether the D4 IC50 is trustworthy.",
     "C11 gives a clean four-parameter fit: IC50 41 nM, R2 0.996, and the curve reaches the "
     "isotype-free baseline, so the number is well determined.\n\n"
     "D4 is weaker on both counts. The fitted IC50 is 380 nM but the bottom plateau sits at 4620 MFI "
     "against a 1180 MFI baseline for C11, so the curve never reaches full blockade inside the tested "
     "range. The fit is extrapolating the bottom, which makes the IC50 an underestimate of the true "
     "potency gap. If D4 matters, repeat with the titration extended two more three-fold steps.",
     "result_analysis"),
    ("cpgfp", dt(2026, 6, 20, 11, 5),
     "Which cpGFP variant should we take forward, and what should the next round randomise?",
     "T203V is the clear pick: dynamic range 9.6 against 4.8 for the parent, with a modest affinity "
     "improvement (Kd 204 nM vs 285 nM) and the cleanest gel in the panel.\n\n"
     "For round 2 I would not re-randomise linker 1 - L60Q was brighter but did not move dynamic "
     "range, which suggests linker 1 is not limiting. Randomise linker 2 instead, and carry T203V as "
     "the fixed background. Keep N62D out of the next library: the 32 kDa band on the gel says it is "
     "being cleaved, so its flat titration is an artefact rather than a real loss of function.",
     "project_science_question"),
    ("calb", dt(2026, 7, 19, 15, 30),
     "Do the CalB single mutants combine additively?",
     "Close to it, but not exactly. D223G gives +3.3 C and L278M gives +2.4 C; strict additivity would "
     "predict +5.7 C for the double and you measured +6.4 C. The 0.7 C excess is small relative to the "
     "0.2-0.4 C standard deviations, so I would describe it as additive within error rather than "
     "claim positive epistasis.\n\n"
     "One caveat worth recording: the wild type shows a faint 66 kDa band on the purity gel that the "
     "double mutant does not. If some of the wild-type sample is dimeric, the wild-type Tm baseline "
     "could be shifted slightly, which would inflate every delta by the same amount.",
     "result_analysis"),
    ("ops", dt(2026, 7, 21, 8, 55),
     "The DH5alpha competent batch came out ten times worse than the BL21 batch. What is the most "
     "likely cause given what is in the notebook?",
     "The notebook records that the cells sat on ice for an extra 20 minutes before the TFB1 step "
     "because the centrifuge was in use. That is the most likely single cause: the window between "
     "harvest and TFB1 resuspension is where efficiency is usually lost.\n\n"
     "Two supporting observations: harvest OD600 was 0.44, slightly past the 0.35-0.45 sweet spot, "
     "and the aliquot count went up from 96 to 120 in the good batch, which means the cell density "
     "per tube was similar. Neither explains a ten-fold drop on its own, so I would repeat with the "
     "centrifuge booked in advance before changing anything else in the protocol.",
     "project_science_question"),
    ("", dt(2026, 8, 12, 16, 20),
     "Do we have p-nitrophenyl butyrate in stock, and where is it?",
     "Yes. p-Nitrophenyl butyrate, CAS 2635-84-9, Sigma-Aldrich N9876, 1 g unit, is recorded in the "
     "Freezer -20 zone. It is listed as opened, so check the remaining volume before you plan a full "
     "plate. There is also p-nitrophenol (CAS 100-02-7) on Shelf D3 if you need a standard curve.",
     "inventory_lookup"),
]

def write_chat_log(projects):
    sessions = []
    for index, (pkey, when, user_text, assistant_text, intent) in enumerate(CHAT_DEFS):
        session_id = f"chat-m{''.join(RNG.choice('0123456789abcdefghijklmnopqrstuvwxyz') for _ in range(7))}-{''.join(RNG.choice('0123456789abcdefghijklmnopqrstuvwxyz') for _ in range(8))}"
        request_id = f"{ms(when)}-{''.join(RNG.choice('0123456789abcdef') for _ in range(8))}"
        project = projects.get(pkey)
        project_id = project["id"] if project else ""
        project_name = project["name"] if project else ""
        rows = [
            {"type": "session-created", "session_id": session_id, "timestamp": iso(when),
             "title": "New Chat", "project_id": project_id, "project_name": project_name},
            {"type": "user-message", "session_id": session_id,
             "message_id": f"user-{request_id}", "timestamp": iso(when + timedelta(seconds=6)),
             "direction": "user->llm", "text": user_text, "meta": {"attachments": []},
             "project_id": project_id, "project_name": project_name},
            {"type": "agent-chat-request", "requestId": request_id,
             "timestamp": iso(when + timedelta(seconds=6)), "direction": "user->llm",
             "projectId": project_id, "projectName": project_name,
             "storagePath": ROOT, "allowWriteTools": False, "message": user_text,
             "attachments": [], "conversation": [{"role": "user", "text": user_text}],
             "llm": {"provider": "codex", "model": "gpt-5.4-mini"}},
            {"type": "agent-lifecycle", "requestId": request_id, "stage": "request_received",
             "status": "ok", "message": user_text,
             "timestamp": iso(when + timedelta(seconds=6)),
             "meta": {"project_id": project_id, "project_name": project_name,
                      "allow_write_tools": False, "provider": "codex", "developer_mode": False,
                      "deep_research_enabled": False},
             "session_id": session_id},
            {"type": "agent-lifecycle", "requestId": request_id, "stage": "intent_parsed",
             "status": "ok", "message": f"Primary intent: {intent}",
             "timestamp": iso(when + timedelta(seconds=9)), "session_id": session_id},
            {"type": "agent-lifecycle", "requestId": request_id, "stage": "context_collected",
             "status": "ok", "message": "Collected notebook, protocol and inventory context.",
             "timestamp": iso(when + timedelta(seconds=13)), "session_id": session_id},
            {"type": "agent-llm-trace", "requestId": request_id, "stage": "responder",
             "timestamp": iso(when + timedelta(seconds=15)),
             "model": "gpt-5.4-mini", "input_tokens": 4128 + index * 211,
             "output_tokens": 512 + index * 47, "latency_ms": 8400 + index * 610,
             "session_id": session_id},
            {"type": "assistant-message", "session_id": session_id,
             "message_id": f"assistant-{request_id}",
             "timestamp": iso(when + timedelta(seconds=24)), "direction": "llm->user",
             "text": assistant_text,
             "meta": {"parser": {"primary_intent": intent, "reasoning_effort": 1},
                      "developer_trace": [], "requestText": user_text}},
            {"type": "agent-chat-result", "requestId": request_id,
             "timestamp": iso(when + timedelta(seconds=24)), "direction": "llm->user",
             "ok": True, "failure_reasons": [],
             "parser": {"primary_intent": intent, "reasoning_effort": 1,
                        "needs_clarification": False, "entities": {}},
             "developer_trace": [], "error": "", "session_id": session_id},
            {"type": "agent-lifecycle", "requestId": request_id, "stage": "response_delivered",
             "status": "ok", "message": "Response delivered to the renderer.",
             "timestamp": iso(when + timedelta(seconds=24)), "session_id": session_id},
        ]
        wjsonl(os.path.join(ROOT, "chat_log", f"{session_id}.log"), rows)
        wjson(os.path.join(ROOT, "chat_log", "transformed", f"{session_id}.json"), {
            "session_id": session_id,
            "source_log_file": f"{session_id}.log",
            "transformed_at": iso(when + timedelta(seconds=30)),
            "entry_count": 2,
            "entries": [
                {"stage": "intent_parser", "request_id": request_id,
                 "timestamp": iso(when + timedelta(seconds=9)),
                 "system_prompt": "Return valid JSON only.\n\nYou are an intent and entity parser "
                                  "for a lab assistant app.",
                 "user_prompt": user_text,
                 "response": json.dumps({"primary_intent": intent, "reasoning_effort": 1})},
                {"stage": "responder", "request_id": request_id,
                 "timestamp": iso(when + timedelta(seconds=24)),
                 "system_prompt": "You are Hikari, a lab assistant. Answer from the provided "
                                  "notebook, protocol and inventory context.",
                 "user_prompt": user_text,
                 "response": assistant_text},
            ],
        })
        sessions.append({
            "id": session_id,
            "title": user_text,
            "project_id": project_id,
            "project_name": project_name,
            "log_file": f"{session_id}.log",
            "created_at": iso(when),
            "updated_at": iso(when + timedelta(seconds=24)),
            "codex_session_id": "-".join(
                "".join(RNG.choice("0123456789abcdef") for _ in range(size))
                for size in (8, 4, 4, 4, 12)),
            "status": "active",
            "message_count": 2,
            "request_count": 1,
            "last_message_preview": assistant_text.splitlines()[0][:240],
            "last_user_message_preview": user_text[:240],
        })
    wjson(os.path.join(ROOT, "chat_log", "index.json"),
          {"version": 1, "updated_at": iso(dt(2026, 8, 26, 21, 30)), "sessions": sessions})

# ---------------------------------------------------------------- protocols / samples on disk
def write_protocols():
    for protocol in PROTOCOLS.values():
        target = os.path.join(ROOT, "Protocol", folder(protocol["name"], protocol["id"]))
        wjson(os.path.join(target, "protocol.json"),
              envelope("hikari_protocols", "protocol", protocol))
        if protocol["selectionInsights"]:
            wjson(os.path.join(target, "selection-insights.json"),
                  {"protocolId": protocol["id"], "insights": protocol["selectionInsights"]})

def write_samples():
    wjson(os.path.join(ROOT, "Samples", "samples.json"),
          envelope("hikari_samples", "samples", SAMPLES))

def js_simple_hash(value):
    h = 0
    for ch in str(value or ""):
        h = ((h << 5) - h) + ord(ch)
        h &= 0xFFFFFFFF
    if h >= 0x80000000:
        h -= 0x100000000
    return f"h{abs(h):x}"

def collect_paper_records():
    """Mirror the app's storage_scan discovery so the sqlite index matches."""
    papers = []
    clubs = {}
    pdf_paths = []
    for base, _dirs, files in os.walk(ROOT):
        parts = rel(base).split("/")
        if not any(part in ("Papers", "RelatedPapers") for part in parts):
            continue
        for name in sorted(files):
            if name.lower().endswith(".pdf"):
                pdf_paths.append(os.path.join(base, name))
    for abs_path in sorted(pdf_paths):
            name = os.path.basename(abs_path)
            relative = rel(abs_path)
            parts = relative.split("/")
            stat_time = iso(datetime.fromtimestamp(os.path.getmtime(abs_path), tz=timezone.utc))
            if parts[0].lower() == "project" and parts[2].lower() == "papers":
                project_folder = parts[1]
                linked_type, linked_name = "project", project_folder.replace("_", " ")
                linked_id = PROJECT_ID_BY_FOLDER.get(project_folder, project_folder)
            else:
                club = parts[1]
                linked_type = "journal-club"
                linked_id = f"journal-club-{js_simple_hash(club.lower())}"
                linked_name = club
                clubs[linked_id] = {"id": linked_id, "name": club,
                                    "description": "Discovered from the storage root Papers folder."}
            papers.append({
                "id": f"paper-{js_simple_hash(relative.lower())}",
                "title": os.path.splitext(name)[0].replace("_", " ").replace("-", " ").strip(),
                "fileName": name,
                "pdfDataUrl": "",
                "storedFilePath": "",
                "storedRelativePath": relative,
                "linkedType": linked_type,
                "linkedId": linked_id,
                "linkedName": linked_name,
                "summary": "",
                "summaryStructured": None,
                "summaryStatus": "idle",
                "methodsExtract": [],
                "methodsStatus": "idle",
                "keyReagents": [],
                "reagentsStatus": "idle",
                "keyFigures": [],
                "highlights": [],
                "comments": [],
                "deepReadReady": False,
                "availabilityStatus": "uploaded_pdf",
                "ingestionStatus": "uploaded",
                "ingestionUpdatedAt": stat_time,
                "ingestionErrors": [],
                "discoverySource": "storage_scan",
                "discoveredAt": stat_time,
                "createdAt": stat_time,
                "updatedAt": stat_time,
            })
    return papers, list(clubs.values())

PROJECT_ID_BY_FOLDER = {}

def write_protocol_index(notebook_entries, papers, assays, gels, workflows):
    path = os.path.join(ROOT, "Protocol", "protocol.index.sqlite")
    if os.path.exists(path):
        os.remove(path)
    db = sqlite3.connect(path)
    db.executescript("""
      CREATE TABLE inventory_personal (zone TEXT NOT NULL, id TEXT NOT NULL, name TEXT,
        quantity TEXT, location TEXT, search_text TEXT, raw_json TEXT, PRIMARY KEY (zone, id));
      CREATE TABLE inventory_samples (id TEXT PRIMARY KEY, code TEXT, name TEXT, sample_type TEXT,
        lot TEXT, concentration TEXT, section TEXT, container_id TEXT, container_name TEXT,
        well_index INTEGER, location_text TEXT, notes TEXT, chemical_links_json TEXT,
        search_text TEXT, raw_json TEXT);
      CREATE TABLE protocol_index (id TEXT PRIMARY KEY, name TEXT, category TEXT, description TEXT,
        tags_json TEXT, linked_project TEXT, step_count INTEGER, steps_preview_json TEXT,
        updated_at TEXT);
      CREATE TABLE notebook_index (id TEXT PRIMARY KEY, protocol_id TEXT, protocol_name TEXT,
        project_id TEXT, project_name TEXT, result TEXT, notebook_state TEXT, executed_at TEXT,
        agent_draft_status TEXT, workflow_id TEXT, proposal_id TEXT, updated_at TEXT,
        created_at TEXT, linked_refs_json TEXT);
      CREATE TABLE paper_index (id TEXT PRIMARY KEY, title TEXT, file_name TEXT, linked_type TEXT,
        linked_id TEXT, linked_name TEXT, stored_relative_path TEXT, availability_status TEXT,
        ingestion_status TEXT, summary_status TEXT, methods_status TEXT, reagents_status TEXT,
        discovered_at TEXT, updated_at TEXT, raw_json TEXT);
      CREATE TABLE record_index (record_type TEXT NOT NULL, record_id TEXT NOT NULL,
        raw_json TEXT, PRIMARY KEY (record_type, record_id));
    """)
    container_name_by_id = {}
    for zone, containers in CONTAINERS.items():
        for container in containers:
            container_name_by_id[container["id"]] = container["name"]
            db.execute("INSERT INTO inventory_personal (zone, id, name, quantity, location,"
                       " search_text, raw_json) VALUES (?,?,?,?,?,?,?)",
                       (zone, container["id"], container["name"], str(len(container["wells"])),
                        zone, f'{zone} {container["name"]}'.lower(), json.dumps(container)))
    for sample in SAMPLES:
        link = sample["inventoryLink"]
        location_text = " / ".join(str(value) for key, value in sample["location"].items()
                                   if key != "storageType" and value)
        db.execute("INSERT INTO inventory_samples (id, code, name, sample_type, lot, concentration,"
                   " section, container_id, container_name, well_index, location_text, notes,"
                   " chemical_links_json, search_text, raw_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (sample["id"], sample["code"], sample["name"], sample["type"], sample["lot"],
                    sample["concentration"], link["section"], link["containerId"],
                    container_name_by_id.get(link["containerId"], ""), link["wellIndex"],
                    location_text, sample["notes"], json.dumps(sample["chemicalLinks"]),
                    f'{sample["code"]} {sample["name"]} {sample["notes"]}'.lower(),
                    json.dumps(sample)))
    for protocol in PROTOCOLS.values():
        db.execute("INSERT INTO protocol_index (id, name, category, description, tags_json,"
                   " linked_project, step_count, steps_preview_json, updated_at)"
                   " VALUES (?,?,?,?,?,?,?,?,?)",
                   (protocol["id"], protocol["name"], protocol["category"], protocol["purpose"],
                    json.dumps(protocol["tags"]), protocol["linkedProject"],
                    len(protocol["steps"]),
                    json.dumps([step["text"][:160] for step in protocol["steps"][:3]]),
                    protocol["updatedAt"]))
        db.execute("INSERT OR REPLACE INTO record_index (record_type, record_id, raw_json)"
                   " VALUES ('protocol', ?, ?)", (protocol["id"], json.dumps(protocol)))
    for entry in notebook_entries:
        db.execute("INSERT OR REPLACE INTO notebook_index (id, protocol_id, protocol_name,"
                   " project_id, project_name, result, notebook_state, executed_at,"
                   " agent_draft_status, workflow_id, proposal_id, updated_at, created_at,"
                   " linked_refs_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (entry["id"], entry["protocolId"], entry["protocolName"], entry["projectId"],
                    entry["projectName"], entry["result"], entry["notebookState"],
                    entry["executedAt"], entry.get("agentDraftStatus", ""),
                    entry.get("workflowId", ""), "", entry["updatedAt"], entry["createdAt"],
                    json.dumps({"assays": [], "gels": []})))
        db.execute("INSERT OR REPLACE INTO record_index (record_type, record_id, raw_json)"
                   " VALUES ('notebook', ?, ?)", (entry["id"], json.dumps(entry)))
    for paper in papers:
        db.execute("INSERT OR REPLACE INTO paper_index (id, title, file_name, linked_type,"
                   " linked_id, linked_name, stored_relative_path, availability_status,"
                   " ingestion_status, summary_status, methods_status, reagents_status,"
                   " discovered_at, updated_at, raw_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (paper["id"], paper["title"], paper["fileName"], paper["linkedType"],
                    paper["linkedId"], paper["linkedName"], paper["storedRelativePath"],
                    paper["availabilityStatus"], paper["ingestionStatus"], paper["summaryStatus"],
                    paper["methodsStatus"], paper["reagentsStatus"], paper["discoveredAt"],
                    paper["updatedAt"], json.dumps(paper)))
        db.execute("INSERT OR REPLACE INTO record_index (record_type, record_id, raw_json)"
                   " VALUES ('paper', ?, ?)", (paper["id"], json.dumps(paper)))
    for assay in assays:
        db.execute("INSERT OR REPLACE INTO record_index (record_type, record_id, raw_json)"
                   " VALUES ('assay', ?, ?)", (assay["id"], json.dumps(assay)))
    for gel in gels:
        db.execute("INSERT OR REPLACE INTO record_index (record_type, record_id, raw_json)"
                   " VALUES ('gel', ?, ?)", (gel["id"], json.dumps(gel)))
    for workflow in workflows:
        db.execute("INSERT OR REPLACE INTO record_index (record_type, record_id, raw_json)"
                   " VALUES ('workflow', ?, ?)", (workflow["id"], json.dumps(workflow)))
    db.commit(); db.close()

# ---------------------------------------------------------------- main
def main():
    if os.path.exists(ROOT):
        shutil.rmtree(ROOT)
    os.makedirs(ROOT)

    skills_src = os.path.join(SRC, ".agents", "skills")
    if os.path.isdir(skills_src):
        shutil.copytree(skills_src, os.path.join(ROOT, ".agents", "skills"))

    write_protocols()
    write_samples()
    write_chemicals_sqlite()

    projects, notebook_entries = write_projects()
    PROJECT_ID_BY_FOLDER.update({sanitize(p["name"]): p["id"] for p in projects.values()})

    write_papers(projects)
    sequences = write_sequences()

    notebook_by_experiment = {entry["experimentName"]: entry for entry in notebook_entries}
    assays = write_assays(projects, notebook_by_experiment)
    gels = write_gels(projects, notebook_by_experiment)

    templates, workflows, workflow_entries = write_workflows(projects)
    write_chat_log(projects)

    papers, clubs = collect_paper_records()
    write_protocol_index(notebook_entries + workflow_entries, papers, assays, gels, workflows)

    # the gel plugin keeps a mirror of one record under its own plugin folder
    plugin_gel_root = os.path.join(ROOT, "Plugins", "gel", "Gels")
    os.makedirs(plugin_gel_root, exist_ok=True)
    first_gel = sorted(os.listdir(os.path.join(ROOT, "Gels")))[0]
    shutil.copytree(os.path.join(ROOT, "Gels", first_gel),
                    os.path.join(plugin_gel_root, first_gel))

    summary = {
        "projects": len(projects),
        "protocols": len(PROTOCOLS),
        "notebookPages": len(notebook_entries) + len(workflow_entries),
        "workflowTemplates": len(templates),
        "workflows": len(workflows),
        "assays": len(assays),
        "gels": len(gels),
        "sequences": len(sequences),
        "papers": len(papers),
        "journalClubs": len(clubs),
        "samples": len(SAMPLES),
        "containers": sum(len(v) for v in CONTAINERS.values()),
        "chemicals": len(CHEMICALS),
        "chatSessions": len(CHAT_DEFS),
    }
    print(json.dumps(summary, indent=2))
    finalize()

def finalize():
    """Let the app build its own indexes: sequence library, then the storage manifest."""
    import subprocess
    steps = [
        ("sequence library", "const lib=require('./src/renderer/modules/sequence-viewer/main-process/"
                             "sequence-library/index.js');"
                             "lib.listSequenceEntries({storagePath:process.argv[1]})"
                             ".then(r=>console.log('sequence entries',r.entries.length))"
                             ".catch(e=>{console.error(e);process.exit(1)});"),
        ("storage manifest", "const {importStorageRoot}=require('./src/main/storage');"
                             "importStorageRoot({storagePath:process.argv[1]})"
                             ".then(r=>console.log('import warnings',r.warnings.length))"
                             ".catch(e=>{console.error(e);process.exit(1)});"),
    ]
    for label, script in steps:
        result = subprocess.run(["node", "-e", script, ROOT], cwd=REPO,
                                capture_output=True, text=True)
        if result.returncode != 0:
            raise SystemExit(f"{label} step failed:\n{result.stderr}")
        print(f"{label}: {result.stdout.strip().splitlines()[-1]}")

if __name__ == "__main__":
    main()
