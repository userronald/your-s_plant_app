import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Check, Download, Leaf, LogIn, LogOut, Search, ShieldCheck, Sprout, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Discovery, DoctorAnswers, DoctorAssessment, DoctorCause, GrowthCheck, Plant, Symptom } from "../domain/types";
import { EmptyState, ErrorState, PageHeader, PlantCard, PlantPhotoUploader, useDialogFocus, useEscapeToClose } from "../components/PlantUi";
import { useAppData } from "../state/AppDataContext";
import { useAuth } from "../data/AuthContext";
import { isDemoMode } from "../data/env";
import { exportUserData, loadProfilePreferences, requestAccountDeletion, updateProfilePreferences } from "../data/cloudRepository";
import { doctorAnswersSchema, doctorSchema, signInSchema, signUpSchema, type DoctorInput, type SignInInput, type SignUpInput } from "../domain/validation";
import { createDemoAssessment, createManualAssessment } from "../domain/monitoring";
import { observationModeLabel } from "../domain/growthMonitoring";
import { prepareDoctorPhotos, requestPlantDoctor } from "../data/plantDoctor";
import { requestGrowthCheck } from "../data/growthCheck";

const SETTINGS_STORAGE_KEY = "plant-ai-companion-settings-v1";
interface DemoSettings {
  units: "metric" | "imperial";
  notifications: boolean;
  quietHours: boolean;
  quietStart: string;
  quietEnd: string;
}

function isDemoSettings(value: unknown): value is DemoSettings {
  if (typeof value !== "object" || value === null) return false;
  const settings = value as Record<string, unknown>;
  return (settings.units === "metric" || settings.units === "imperial")
    && typeof settings.notifications === "boolean"
    && typeof settings.quietHours === "boolean"
    && typeof settings.quietStart === "string"
    && /^\d{2}:\d{2}$/.test(settings.quietStart)
    && typeof settings.quietEnd === "string"
    && /^\d{2}:\d{2}$/.test(settings.quietEnd);
}

function hasCareReminders(preferences: unknown): boolean {
  return typeof preferences === "object" && preferences !== null
    && !Array.isArray(preferences)
    && "care_reminders" in preferences
    && preferences.care_reminders === true;
}

export function PlantsCollectionPage({ onCare }: { onCare: (plant: Plant) => void }) {
  const { plants, careTasks } = useAppData();
  const [query, setQuery] = useState("");
  const [healthFilter, setHealthFilter] = useState("all");
  const [roomFilter, setRoomFilter] = useState("all");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const rooms = [...new Set(plants.map((plant) => plant.location).filter((room) => room !== "Choose a location"))];
  const filtered = plants.filter((plant) =>
    `${plant.name} ${plant.scientificName} ${plant.location}`.toLowerCase().includes(query.toLowerCase())
    && (healthFilter === "all" || plant.health === healthFilter)
    && (roomFilter === "all" || plant.location === roomFilter),
  );
  return <>
    <PageHeader eyebrow="YOUR GROWING SPACE" title="My plants" description={`${plants.length} plant${plants.length === 1 ? "" : "s"} in your care.`} action={<Link to="/scan" className="button-primary"><Sprout size={16} /> Add a plant</Link>} />
    <div className="collection-toolbar"><label className="search-field"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, species or room" aria-label="Search your plants" /></label>
      <label className="filter-control">Health <select value={healthFilter} onChange={(event) => setHealthFilter(event.target.value)}><option value="all">All plants</option><option value="good">Doing well</option><option value="check">Keep an eye on</option><option value="attention">Needs attention</option></select></label>
      <label className="filter-control">Room <select value={roomFilter} onChange={(event) => setRoomFilter(event.target.value)}><option value="all">Every room</option>{rooms.map((room) => <option key={room}>{room}</option>)}</select></label>
      <div className="view-switch" aria-label="Plant layout"><button aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}>Grid</button><button aria-pressed={layout === "list"} onClick={() => setLayout("list")}>List</button></div>
    </div>
    {filtered.length ? <div className={`plant-grid plant-grid-large ${layout === "list" ? "plant-list-layout" : ""}`}>{filtered.map((plant) => <PlantCard key={plant.id} plant={plant} nextTask={careTasks.find((task) => task.plantId === plant.id && task.type === "soil_check" && task.status === "pending")} onAction={onCare} />)}</div> :
      <EmptyState title={plants.length ? "No matching plants" : "Your collection is ready to grow"} copy={plants.length ? "Try changing your search or filters." : "Identify a plant you love to keep its care and memories together."} action={!plants.length ? <Link to="/scan" className="button-primary">Identify a plant</Link> : undefined} />}
  </>;
}

export function PassportPage() {
  const { discoveries, plants, addPlantFromDiscovery, removeDiscovery } = useAppData();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [addingDiscovery, setAddingDiscovery] = useState<string | null>(null);
  const [addError, setAddError] = useState("");
  const groups = [...new Set(discoveries.map((item) => item.scientificName))];
  const filtered = discoveries.filter((item) =>
    `${item.commonName} ${item.scientificName}`.toLowerCase().includes(query.toLowerCase())
    && (group === "all" || item.scientificName === group),
  );
  async function addToPlants(discoveryId: string) {
    setAddingDiscovery(discoveryId);
    setAddError("");
    try {
      const plant = await addPlantFromDiscovery(discoveryId);
      if (plant) navigate(`/plants/${plant.id}`);
      else setAddError("This discovery is already in your collection. Refresh the passport to see its plant profile.");
    } catch (error) {
      console.error("Could not add discovery to the garden.", error);
      setAddError(error instanceof Error ? error.message : "Could not add this discovery to your plants.");
    } finally {
      setAddingDiscovery(null);
    }
  }
  return <>
    <PageHeader eyebrow="YOUR FIELD NOTES" title="Plant passport" description="Saved discoveries, whether or not they’re in your collection." action={<Link to="/scan" className="button-primary"><Search size={16} /> Discover a plant</Link>} />
    <div className="passport-toolbar"><label className="search-field"><Search size={18} /><input aria-label="Search saved discoveries" placeholder="Search saved discoveries" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label className="filter-control">Group by species <select value={group} onChange={(event) => setGroup(event.target.value)}><option value="all">All species</option>{groups.map((name) => <option key={name}>{name}</option>)}</select></label></div>
    {addError && <p className="field-error" role="alert">{addError}</p>}
    {!filtered.length ? <EmptyState title={discoveries.length ? "No discoveries match" : "Your field notes are empty"} copy={discoveries.length ? "Try another search or species filter." : "Save a discovery after an identification to start collecting plant passports."} action={!discoveries.length ? <Link to="/scan" className="button-primary">Identify a plant</Link> : undefined} /> :
      <div className="passport-list">{filtered.map((discovery) => {
        const matchingPlant = plants.find((plant) => plant.name === discovery.commonName && plant.scientificName === discovery.scientificName);
        const plantId = discovery.plantId ?? matchingPlant?.id;
        const sourceLabel = discovery.source === "plantnet" ? "LIVE · PL@NTNET"
          : discovery.source === "demo" ? "DEMO RESULT"
            : "SAVED DISCOVERY";
        return <article className="passport-card" key={discovery.id}><img src={discovery.imageUrl} alt={discovery.commonName} /><div className="passport-info"><p className="eyebrow">{sourceLabel}</p><h2>{discovery.commonName}</h2><p className="scientific">{discovery.scientificName}</p><span>Saved {new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(discovery.savedAt))}{discovery.location ? ` · ${discovery.location}` : ""}</span>{discovery.identification?.wasCorrected && <span> · User-corrected identification</span>}{discovery.taxonomyIds && (discovery.taxonomyIds.gbif || discovery.taxonomyIds.powo) && <span> · Taxonomy IDs saved</span>}</div><div className="passport-actions">{plantId ? <Link className="button-secondary button-small" to={`/plants/${plantId}`}>In My plants</Link> : <button className="button-primary button-small" onClick={() => void addToPlants(discovery.id)} disabled={addingDiscovery === discovery.id}>{addingDiscovery === discovery.id ? "Adding…" : "Add to My plants"}</button>}<button className="button-quiet button-small" onClick={() => removeDiscovery(discovery.id)} aria-label={`Remove ${discovery.commonName} discovery`}><Trash2 size={14} /> Remove</button></div></article>;
      })}</div>}
    {groups.length > 0 && <p className="data-note">Grouped into {groups.length} species {groups.length === 1 ? "group" : "groups"} · source labels distinguish live Pl@ntNet results from demo and manual entries.</p>}
  </>;
}

const SYMPTOMS: Array<[Symptom, string]> = [
  ["yellow", "Yellowing leaves"],
  ["droop", "Drooping"],
  ["spots", "Spots or marks"],
  ["pests", "Possible insects"],
  ["wilting", "Wilting"],
  ["other", "Other change"],
];

type DoctorPhotoDraft = { file: File; kind: "whole" | "close-up" };

function CauseList({ causes }: { causes: DoctorCause[] }) {
  return <ol className="doctor-causes" aria-label="Possible causes to check">{causes.map((cause) => <li key={cause.cause}><div><strong>{cause.cause}</strong>{cause.confidence === null && <span className="cause-tag">Not ranked</span>}</div>{cause.supportingEvidence.length > 0 && <div className="evidence"><span>Supporting</span><ul>{cause.supportingEvidence.map((item) => <li key={item}>{item}</li>)}</ul></div>}{cause.contradictoryEvidence.length > 0 && <div className="evidence evidence-against"><span>Contradictory / things to rule out</span><ul>{cause.contradictoryEvidence.map((item) => <li key={item}>{item}</li>)}</ul></div>}</li>)}</ol>;
}

export function PlantDoctorPage() {
  const { plants, addIssueEpisode, addIssueFollowUp, issueEpisodes } = useAppData();
  const [mode, setMode] = useState<"manual" | "ai" | "demo">("manual");
  const [plantId, setPlantId] = useState<string>("");
  const [independent, setIndependent] = useState(false);
  const [photos, setPhotos] = useState<DoctorPhotoDraft[]>([]);
  const [assessment, setAssessment] = useState<DoctorAssessment | null>(null);
  const [error, setError] = useState("");
  const [savedEpisodeId, setSavedEpisodeId] = useState<string | null>(null);
  const [followUpNotes, setFollowUpNotes] = useState<Record<string, string>>({});
  const [followUpError, setFollowUpError] = useState("");
  const [answers, setAnswers] = useState<DoctorAnswers>({
    soilMoisture: "unknown",
    wateringChange: "unsure",
    drainage: "unsure",
    lightChange: "unsure",
    pestsSeen: "unsure",
    fertilizerChange: "unsure",
    temperatureChange: "unsure",
    repottedRecently: "unsure",
  });
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm<DoctorInput>({
    resolver: zodResolver(doctorSchema),
    defaultValues: { symptom: "yellow", context: "" },
  });

  function addPhotos(files: File[]) {
    setError("");
    if (photos.length + files.length > 3) { setError("You can add up to 3 photos."); return; }
    setPhotos((current) => [...current, ...files.map((file) => ({ file, kind: "whole" as const }))]);
  }

  function removePhoto(index: number) {
    setPhotos((current) => current.filter((_, i) => i !== index));
  }

  function setPhotoKind(index: number, kind: "whole" | "close-up") {
    setPhotos((current) => current.map((photo, i) => i === index ? { ...photo, kind } : photo));
  }

  const submit = async (values: DoctorInput) => {
    setError("");
    setAssessment(null);
    setSavedEpisodeId(null);
    try {
      const validatedAnswers = doctorAnswersSchema.parse(answers);
      const preparedPhotos = await prepareDoctorPhotos(photos);
      let result: DoctorAssessment;
      if (mode === "ai") {
        result = await requestPlantDoctor({
          mode: "ai",
          plantId: plantId || null,
          independent,
          symptom: values.symptom,
          context: values.context ?? "",
          answers: validatedAnswers,
          photos: preparedPhotos,
        });
      } else if (mode === "demo") {
        result = createDemoAssessment(values.symptom, validatedAnswers, values.context ?? "", photos.length > 0);
      } else {
        result = createManualAssessment(values.symptom, validatedAnswers, values.context ?? "", photos.length > 0);
      }
      const selectedPlantId = plantId && !independent ? plantId : null;
      const photoEntries = preparedPhotos.map((photo) => ({ name: photo.file.name, url: photo.dataUrl, kind: photo.kind }));
      const episode = await addIssueEpisode({
        plantId: selectedPlantId,
        independent: independent || selectedPlantId === null,
        symptom: values.symptom,
        description: values.context ?? "",
        answers: validatedAnswers,
        photos: photoEntries,
        photoFiles: preparedPhotos.map((photo) => photo.file),
        assessment: result,
      });
      setAssessment(result);
      setSavedEpisodeId(episode.id);
    } catch (err) {
      console.error("Plant doctor request failed.", err);
      setError(err instanceof Error ? err.message : "The plant doctor request could not be completed.");
    }
  };

  function startOver() {
    setAssessment(null);
    setSavedEpisodeId(null);
    setPhotos([]);
    setAnswers({
      soilMoisture: "unknown",
      wateringChange: "unsure",
      drainage: "unsure",
      lightChange: "unsure",
      pestsSeen: "unsure",
      fertilizerChange: "unsure",
      temperatureChange: "unsure",
      repottedRecently: "unsure",
    });
    setError("");
    reset({ symptom: "yellow", context: "" });
  }

  async function saveIssueFollowUp(episodeId: string) {
    const note = followUpNotes[episodeId] ?? "";
    try {
      setFollowUpError("");
      await addIssueFollowUp(episodeId, note);
      setFollowUpNotes((current) => ({ ...current, [episodeId]: "" }));
    } catch (reason) {
      setFollowUpError(reason instanceof Error ? reason.message : "Could not save this follow-up.");
    }
  }

  return <>
    <PageHeader eyebrow="PLANT HEALTH" title="Plant Doctor" description="Describe what you see. Get possibilities to check—not a diagnosis." />
    <div className="doctor-banner"><ShieldCheck size={18} /><span><strong>Evidence over certainty.</strong> A visible symptom is not proof of a specific cause. If evidence is inadequate or the plant worsens, seek expert review.</span></div>
    <div className="doctor-layout"><section className="panel doctor-form"><h2>Assessment details</h2><p className="subtle">Choose the closest symptom and add context or photos.</p>
      <div className="doctor-mode-row">
        <button type="button" className={`choice-chip ${mode === "manual" ? "choice-selected" : ""}`} onClick={() => setMode("manual")}>Checklist</button>
        <button type="button" className={`choice-chip ${mode === "demo" ? "choice-selected" : ""}`} onClick={() => setMode("demo")}>Demo example</button>
        <button type="button" className={`choice-chip ${mode === "ai" ? "choice-selected" : ""}`} onClick={() => setMode("ai")}>AI-assisted (signed in)</button>
      </div>
      <div className="doctor-plant-row">
        <label className="form-label">Plant</label>
        <select value={plantId} onChange={(e) => { setPlantId(e.target.value); setIndependent(e.target.value === ""); }}>
          <option value="">Independent assessment (no plant selected)</option>
          {plants.map((plant) => <option key={plant.id} value={plant.id}>{plant.name}</option>)}
        </select>
        <label className="checkbox-row"><input type="checkbox" checked={independent || plantId === ""} onChange={(e) => setIndependent(e.target.checked)} /> Treat as independent observation</label>
      </div>
      <form onSubmit={handleSubmit(submit)}>
        <fieldset><legend>Visible symptom</legend><div className="symptom-grid">{SYMPTOMS.map(([value, label]) => <label key={value} className="symptom-option"><input type="radio" value={value} {...register("symptom")} /><span>{label}</span></label>)}</div>{errors.symptom && <p className="field-error">{errors.symptom.message}</p>}</fieldset>
        <label className="form-label" htmlFor="doctor-context">Notes (where/when/change)</label><textarea id="doctor-context" rows={3} placeholder="Optional context about the change…" {...register("context")} />{errors.context && <p className="field-error">{errors.context.message}</p>}
        <fieldset className="doctor-questions"><legend>Recent conditions and changes</legend>
          <label className="form-label">Soil moisture <select value={answers.soilMoisture} onChange={(e) => setAnswers({ ...answers, soilMoisture: e.target.value as DoctorAnswers["soilMoisture"] })}><option value="unknown">Unsure</option><option value="dry">Dry</option><option value="slightly_moist">Slightly moist</option><option value="wet">Wet</option></select></label>
          {([
            ["wateringChange", "Has watering changed recently?"],
            ["drainage", "Does the pot drain freely?"],
            ["lightChange", "Has the plant's light exposure changed?"],
            ["pestsSeen", "Have you seen possible pests?"],
            ["fertilizerChange", "Has fertilizer use changed recently?"],
            ["temperatureChange", "Has temperature or airflow changed?"],
            ["repottedRecently", "Was the plant repotted recently?"],
          ] as const).map(([field, label]) => <label className="form-label" key={field}>{label}<select value={answers[field]} onChange={(e) => setAnswers({ ...answers, [field]: e.target.value as DoctorAnswers[typeof field] })}><option value="unsure">Unsure</option><option value="yes">Yes</option><option value="no">No</option></select></label>)}
        </fieldset>
        <div className="doctor-photo">
          <PlantPhotoUploader label="Add symptom photos (up to 3)" onChange={() => {}} onFilesChange={addPhotos} multiple />
          {photos.length > 0 && <div className="doctor-photo-list">{photos.map((photo, index) => <div key={index} className="doctor-photo-item"><span>{photo.file.name}</span><select value={photo.kind} onChange={(e) => setPhotoKind(index, e.target.value as "whole" | "close-up")}><option value="whole">Whole plant</option><option value="close-up">Close-up</option></select><button type="button" className="button-quiet button-small" onClick={() => removePhoto(index)}>Remove</button></div>)}</div>}
          {mode === "ai" && <span className="subtle">For AI, photos are prepared and sent to the plant-doctor function. If not configured, you’ll see an error with a suggestion to use checklist/demo.</span>}
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button className="button-primary" disabled={isSubmitting}>{isSubmitting ? "Assessing…" : mode === "ai" ? "Get AI observations" : mode === "demo" ? "Show demo guidance" : "Get checklist"} <ArrowRight size={15} /></button>
      </form>
    </section>
    <aside className="panel doctor-safety"><div className="icon-badge"><ShieldCheck size={18} /></div><h2>Safe practice</h2><p>Start with observable facts. Avoid changing multiple things at once.</p><ul><li>Check soil and drainage</li><li>Look on both sides of leaves and stems</li><li>Watch for spread over 24–72 hours</li><li>Consult a qualified expert if rapidly worsening or unsure</li></ul><p className="subtle">Records include observed vs inferred distinction and safety guidance.</p></aside>
    </div>
    {assessment && <section className="doctor-result panel" aria-live="polite"><div className="doctor-result-title"><div><p className="eyebrow">{assessment.mode === "ai" ? "AI-ASSISTED OBSERVATIONS" : assessment.mode === "demo" ? "DEMO GUIDANCE" : "CHECKLIST"}</p><h2>Possible causes to check (not a diagnosis)</h2></div><button className="button-quiet" onClick={startOver}>Start over</button></div><p className="subtle">{assessment.disclaimer}</p><div><strong>Observed</strong><ul className="observed-list">{assessment.observedSymptoms.map((item) => <li key={item}>{item}</li>)}</ul></div><CauseList causes={assessment.causes} /><div className="safe-next-step"><strong>Immediate actions</strong><ul>{assessment.immediateActions.map((item) => <li key={item}>{item}</li>)}</ul><strong>Avoid</strong><ul>{assessment.avoid.map((item) => <li key={item}>{item}</li>)}</ul></div><div className="follow-up-schedule"><strong>Follow-up</strong><p>Recheck in about {assessment.followUpDays} day{assessment.followUpDays === 1 ? "" : "s"}. {assessment.seekExpertReview ? "Seek qualified horticultural or agricultural review if evidence is inadequate or symptoms worsen." : ""}</p>{assessment.model && <p className="subtle">Model: {assessment.model}{assessment.provider ? ` · Provider: ${assessment.provider}` : ""}</p>}</div>{savedEpisodeId && <div className="doctor-saved"><Check size={16} /><span>Saved to Plant Doctor history{plantId && !independent ? " for this plant" : independent || plantId === "" ? " as independent" : ""}.</span></div>}
    </section>}
    {followUpError && <p className="field-error" role="alert">{followUpError}</p>}
    {issueEpisodes.length > 0 && <section className="panel issue-history"><p className="eyebrow">YOUR RECORDS</p><h2>Plant Doctor history</h2>{issueEpisodes.map((episode) => <article key={episode.id}><div><strong>{episode.title}</strong><time>{new Date(episode.startedAt).toLocaleString()}</time></div><p>{episode.assessment.observedSymptoms.join(" · ")}</p><details><summary>Assessment and follow-up ({episode.followUps.length})</summary><p>{episode.assessment.disclaimer}</p><CauseList causes={episode.assessment.causes} />{episode.photos.map((photo) => <img className="issue-history-photo" key={photo.url} src={photo.url} alt={`${photo.kind} symptom view`} />)}{episode.followUps.map((followUp) => <p key={followUp.id}><strong>{new Date(followUp.observedAt).toLocaleString()}:</strong> {followUp.note}</p>)}<label className="form-label">Add follow-up observation<textarea rows={2} maxLength={2000} value={followUpNotes[episode.id] ?? ""} onChange={(event) => setFollowUpNotes((current) => ({ ...current, [episode.id]: event.target.value }))} placeholder="Record what changed, stayed the same, or worsened…" /></label><button className="button-secondary button-small" disabled={!(followUpNotes[episode.id] ?? "").trim()} onClick={() => void saveIssueFollowUp(episode.id)}>Save follow-up</button></details></article>)}</section>}
  </>;
}

export function GrowthCheckPage() {
  const { plants, addGrowthCheck, confirmGrowthCheck, growthChecks } = useAppData();
  const [mode, setMode] = useState<"manual" | "ai" | "demo">("manual");
  const [plantId, setPlantId] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [previousChoice, setPreviousChoice] = useState<string>("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<GrowthCheck | null>(null);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [correction, setCorrection] = useState("");

  const previousGrowth = previousChoice ? growthChecks.find((g) => g.id === previousChoice) : null;

  function addPhotos(files: File[]) {
    setError("");
    if (photos.length + files.length > 2) { setError("You can add up to 2 new photos for this check-in."); return; }
    setPhotos((current) => [...current, ...files]);
  }

  function removePhoto(index: number) {
    setPhotos((current) => current.filter((_, i) => i !== index));
  }

  async function submit() {
    setError("");
    setResult(null);
    if (!plantId) { setError("Choose a plant."); return; }
    if (photos.length === 0) { setError("Choose at least one photo."); return; }
    setIsSubmitting(true);
    try {
      const requestResult = await requestGrowthCheck({
        mode,
        plantId,
        note,
        photos,
        previousPhotoUrl: previousGrowth?.photoUrl ?? null,
        previousCapturedAt: previousGrowth?.capturedAt ?? null,
      });
      const saved = await addGrowthCheck({
        plantId,
        photos: requestResult.photos.map((p) => ({ name: p.file.name, url: p.dataUrl })),
        photoFiles: requestResult.photos.map((p) => p.file),
        photoUrl: requestResult.photos[0].dataUrl,
        photoName: requestResult.photos[0].file.name,
        previousPhotoUrl: previousGrowth?.photoUrl ?? null,
        previousCapturedAt: previousGrowth?.capturedAt ?? null,
        previousCheckId: previousGrowth?.id ?? null,
        previousPhotoId: previousGrowth?.photos[0]?.id ?? null,
        note,
        observation: requestResult.observation,
        model: requestResult.observation.model ?? (mode === "demo" ? "demo-growth-checklist-v1" : mode === "manual" ? "manual" : "unknown"),
      });
      setResult(saved);
      setPhotos([]);
      setNote("");
    } catch (err) {
      console.error("Growth check failed.", err);
      setError(err instanceof Error ? err.message : "The growth check could not be completed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const plantGrowths = plantId ? growthChecks.filter((g) => g.plantId === plantId).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)) : [];

  async function saveConfirmation(confirmation: "confirmed" | "corrected" | "not_confirmed", userCorrection: string) {
    if (!result) return;
    try {
      setError("");
      await confirmGrowthCheck(result.id, confirmation, userCorrection);
      setResult({ ...result, userConfirmation: confirmation, userCorrection });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save your confirmation.");
    }
  }

  return <>
    <PageHeader eyebrow="GROWTH CHECK" title="Track changes over time" description="Save dated photos and notes. We only describe visible changes with caveats—no calibrated measurements." />
    <div className="doctor-banner"><ShieldCheck size={18} /><span><strong>Visual observations only.</strong> Angle, lighting, distance, and image quality can mislead. We do not infer precise biological growth from 2D images.</span></div>
    {plants.length === 0 ? <EmptyState title="Add a plant first" copy="Growth checks are tied to a plant in your collection." action={<Link to="/scan" className="button-primary">Identify a plant</Link>} /> :
      <div className="growth-layout">
        <section className="panel growth-form">
          <h2>New check-in</h2>
          <div className="doctor-mode-row">
            <button type="button" className={`choice-chip ${mode === "manual" ? "choice-selected" : ""}`} onClick={() => setMode("manual")}>Checklist</button>
            <button type="button" className={`choice-chip ${mode === "demo" ? "choice-selected" : ""}`} onClick={() => setMode("demo")}>Demo</button>
            <button type="button" className={`choice-chip ${mode === "ai" ? "choice-selected" : ""}`} onClick={() => setMode("ai")}>AI-assisted (signed in)</button>
          </div>
          <label className="form-label">Plant</label>
          <select value={plantId} onChange={(e) => { setPlantId(e.target.value); setPreviousChoice(""); }}>
            <option value="">Choose a plant</option>
            {plants.map((plant) => <option key={plant.id} value={plant.id}>{plant.name}</option>)}
          </select>
          <label className="form-label">Compare to previous check-in (optional)</label>
          <select value={previousChoice} onChange={(e) => setPreviousChoice(e.target.value)} disabled={!plantId || plantGrowths.length === 0}>
            <option value="">No previous photo / baseline</option>
            {plantGrowths.filter((g) => g.photos.length > 0).map((g) => <option key={g.id} value={g.id}>{new Date(g.capturedAt).toLocaleDateString()} — {g.photoName}</option>)}
          </select>
          {previousGrowth && <div className="growth-previous"><img src={previousGrowth.photoUrl} alt="Previous growth check" /><span className="subtle">Previous photo loaded for reference</span></div>}
          <PlantPhotoUploader label="Add new growth photos (up to 2)" onChange={() => {}} onFilesChange={addPhotos} multiple />
          {photos.length > 0 && <div className="doctor-photo-list">{photos.map((photo, index) => <div key={index} className="doctor-photo-item"><span>{photo.name}</span><button type="button" className="button-quiet button-small" onClick={() => removePhoto(index)}>Remove</button></div>)}</div>}
          <label className="form-label" htmlFor="growth-note">What did you notice?</label>
          <textarea id="growth-note" rows={3} maxLength={1000} placeholder="A new leaf, change in shape, etc." value={note} onChange={(e) => setNote(e.target.value)} />
          {error && <p className="field-error" role="alert">{error}</p>}
          <button className="button-primary" disabled={isSubmitting || !plantId || photos.length === 0} onClick={() => void submit()}>{isSubmitting ? "Saving…" : "Save growth check"} <Check size={15} /></button>
          {mode === "ai" && <p className="subtle">Live comparison calls the growth-check function. If not configured, use demo or checklist.</p>}
        </section>
        <aside className="panel growth-history">
          <h2>History</h2>
          {!plantId && <p className="subtle">Select a plant to see its history.</p>}
          {plantId && plantGrowths.length === 0 && <p className="subtle">No growth checks yet for this plant.</p>}
          {plantGrowths.map((g) => <article key={g.id} className="growth-item"><div className="growth-item-header"><div className="growth-photo-row">{g.photos.map((photo) => <img key={photo.id ?? photo.url} src={photo.url} alt={photo.name} />)}</div><div><strong>{new Date(g.capturedAt).toLocaleString()}</strong><p className="subtle">{g.observation.mode === "ai" ? "AI-assisted" : g.observation.mode === "demo" ? "Demo" : "Checklist"} · {g.userConfirmation === "confirmed" ? "Confirmed" : g.userConfirmation === "corrected" ? "Corrected" : "Not confirmed"}</p></div></div><p>{g.observation.summary}</p>{g.note && <p><strong>User note (not image-verified):</strong> {g.note}</p>}{g.userCorrection && <p><strong>Your correction:</strong> {g.userCorrection}</p>}{g.observation.changes.length > 0 && <ul>{g.observation.changes.map((c) => <li key={c.aspect}><strong>{c.aspect}:</strong> {c.observation}</li>)}</ul>}<details><summary>Caveats</summary><ul>{g.observation.caveats.map((c) => <li key={c}>{c}</li>)}</ul></details><p className="subtle">{g.observation.disclaimer}</p></article>)}
        </aside>
      </div>
    }
    {result && <section className="doctor-result panel" aria-live="polite"><div className="doctor-result-title"><div><p className="eyebrow">{observationModeLabel(result.observation.mode).toUpperCase()}</p><h2>Growth observation</h2></div><button className="button-quiet" onClick={() => setResult(null)}>Close</button></div><p className="subtle">{result.observation.disclaimer}</p>
      <div className="growth-comparison">
        {result.previousPhotoUrl && <figure><img src={result.previousPhotoUrl} alt="Earlier plant photo" /><figcaption>Earlier photo · {result.previousCapturedAt ? new Date(result.previousCapturedAt).toLocaleDateString() : "date unavailable"}</figcaption></figure>}
        {result.photos.map((photo) => <figure key={photo.id ?? photo.url}><img src={photo.url} alt="New plant photo" /><figcaption>New photo · {new Date(result.capturedAt).toLocaleDateString()}</figcaption></figure>)}
      </div>
      {result.note && <p><strong>Your note (not image-verified):</strong> {result.note}</p>}<p><strong>Summary:</strong> {result.observation.summary}</p><div><strong>Visible observations</strong><ul>{result.observation.visibleObservations.map((item) => <li key={item}>{item}</li>)}</ul></div>{result.observation.changes.length > 0 && <div><strong>Changes noted (not measured)</strong><ul>{result.observation.changes.map((c) => <li key={c.aspect}><strong>{c.aspect}:</strong> {c.observation}</li>)}</ul></div>}<div><strong>Cannot determine</strong><ul>{result.observation.cannotDetermine.map((item) => <li key={item}>{item}</li>)}</ul></div><details open><summary><strong>Caveats (angle/lighting/distance/quality)</strong></summary><ul>{result.observation.caveats.map((c) => <li key={c}>{c}</li>)}</ul></details><div className="follow-up-schedule"><strong>Confirm your observation</strong><p className="subtle">Your confirmation helps track accuracy. This is not used to override safety boundaries.</p><div className="choice-row"><button className={`choice-chip ${result.userConfirmation === "confirmed" ? "choice-selected" : ""}`} onClick={() => void saveConfirmation("confirmed", "")}>Confirmed</button><button className={`choice-chip ${result.userConfirmation === "corrected" ? "choice-selected" : ""}`} disabled={!correction.trim()} onClick={() => void saveConfirmation("corrected", correction)}>Corrected</button><button className={`choice-chip ${result.userConfirmation === "not_confirmed" ? "choice-selected" : ""}`} onClick={() => void saveConfirmation("not_confirmed", "")}>Not confirmed</button></div><label className="form-label">If corrected, describe your correction<textarea rows={2} maxLength={1000} placeholder="Describe what you see instead" value={correction} onChange={(e) => setCorrection(e.target.value)} /></label>{result.userCorrection && <p><strong>Your correction:</strong> {result.userCorrection}</p>}{error && <p className="field-error" role="alert">{error}</p>}</div></section>}
    <div className="data-note"><ShieldCheck size={15} /> Visual observations only. No calibrated growth measurement is produced.</div>
  </>;
}

export function LocationGuidePage() {
  const [light, setLight] = useState("bright-indirect");
  const recommendations: Record<string, string[]> = {
    "bright-indirect": ["Monstera", "Golden pothos", "Rubber plant"],
    "low-light": ["Snake plant", "ZZ plant", "Pothos"],
    "direct-sun": ["Jade plant", "Aloe vera", "String of pearls"],
  };
  return <><PageHeader eyebrow="FIND A GOOD FIT" title="Explore by growing spot" description="A small starting point for matching a plant to a room. Check local care guidance before choosing." /><div className="panel location-panel"><label className="form-label" htmlFor="light-level">What is the light like?</label><select id="light-level" value={light} onChange={(event) => setLight(event.target.value)}><option value="bright-indirect">Bright, indirect light</option><option value="low-light">Lower light</option><option value="direct-sun">Direct sun</option></select><div className="recommendation-grid">{recommendations[light].map((name, index) => <article key={name}><img src={["https://images.unsplash.com/photo-1614594975525-e45190c55d0b?auto=format&fit=crop&w=700&q=80", "https://images.unsplash.com/photo-1614594895304-fe7116ac3b58?auto=format&fit=crop&w=700&q=80", "https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=700&q=80"][index]} alt="" /><div><p className="eyebrow">STARTER SUGGESTION · DEMO</p><h3>{name}</h3><Link to="/explore" className="text-link">Explore guides <ArrowRight size={14} /></Link></div></article>)}</div><p className="subtle">Example suggestions only. A room’s light changes throughout the day and across seasons.</p></div></>;
}

export function SettingsPage() {
  const [units, setUnits] = useState<DemoSettings["units"]>("metric");
  const [notifications, setNotifications] = useState(false);
  const [quietHours, setQuietHours] = useState(false);
  const [quietStart, setQuietStart] = useState("21:00");
  const [quietEnd, setQuietEnd] = useState("08:00");
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmAccountDelete, setConfirmAccountDelete] = useState(false);
  const [accountPassword, setAccountPassword] = useState("");
  const [accountDeleteError, setAccountDeleteError] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [message, setMessage] = useState("");
  const [exportFailed, setExportFailed] = useState(false);
  const { plants, discoveries, clearDemoData } = useAppData();
  const auth = useAuth();
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [authMessage, setAuthMessage] = useState("");
  const [authFailed, setAuthFailed] = useState(false);
  const [cloudPreferencesOwner, setCloudPreferencesOwner] = useState<string | null>(null);
  const deleteDialogRef = useRef<HTMLElement>(null);
  const accountDeleteDialogRef = useRef<HTMLElement>(null);
  useDialogFocus(deleteDialogRef, confirmDelete);
  useDialogFocus(accountDeleteDialogRef, confirmAccountDelete);
  useEscapeToClose(() => setConfirmDelete(false));
  useEscapeToClose(() => setConfirmAccountDelete(false));

  useEffect(() => {
    if (!isDemoMode) {
      setPreferencesLoaded(true);
      return;
    }
    try {
      const serialized = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (serialized) {
        const saved: unknown = JSON.parse(serialized);
        if (!isDemoSettings(saved)) throw new Error("Saved settings have an invalid shape.");
        setUnits(saved.units);
        setNotifications(saved.notifications);
        setQuietHours(saved.quietHours);
        setQuietStart(saved.quietStart);
        setQuietEnd(saved.quietEnd);
      }
    } catch (error) {
      console.error("Could not restore demo settings.", error);
      setMessage("Saved preferences could not be read. Current choices will be used instead.");
    } finally {
      setPreferencesLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!isDemoMode || !preferencesLoaded) return;
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ units, notifications, quietHours, quietStart, quietEnd } satisfies DemoSettings));
    } catch (error) {
      console.error("Could not save demo settings.", error);
      setMessage("Preferences could not be saved in this browser.");
    }
  }, [preferencesLoaded, units, notifications, quietHours, quietStart, quietEnd]);

  useEffect(() => {
    const userId = auth.user?.id;
    if (isDemoMode || !userId) {
      setCloudPreferencesOwner(null);
      if (!isDemoMode) {
        setUnits("metric");
        setNotifications(false);
        setQuietHours(false);
        setQuietStart("21:00");
        setQuietEnd("08:00");
      }
      return;
    }
    let active = true;
    setCloudPreferencesOwner(null);
    void loadProfilePreferences().then((profile) => {
      if (!active) return;
      setUnits(profile.units);
      setNotifications(hasCareReminders(profile.notification_preferences));
      setQuietHours(profile.quiet_hours_start !== null && profile.quiet_hours_end !== null);
      setQuietStart(profile.quiet_hours_start?.slice(0, 5) ?? "21:00");
      setQuietEnd(profile.quiet_hours_end?.slice(0, 5) ?? "08:00");
      setCloudPreferencesOwner(userId);
    }).catch((error: unknown) => {
      if (!active) return;
      console.error("Could not load account preferences.", error);
      setAuthFailed(true);
      setAuthMessage(error instanceof Error ? error.message : "Could not load account preferences.");
    });
    return () => { active = false; };
  }, [auth.user?.id]);

  useEffect(() => {
    if (isDemoMode || !auth.user || cloudPreferencesOwner !== auth.user.id) return;
    void updateProfilePreferences({
      units,
      notificationPreferences: { care_reminders: notifications },
      quietHoursStart: quietHours ? quietStart : null,
      quietHoursEnd: quietHours ? quietEnd : null,
    }).catch((error: unknown) => {
      console.error("Could not persist account preferences.", error);
      setMessage(error instanceof Error ? error.message : "Account preferences could not be saved.");
    });
  }, [auth.user, cloudPreferencesOwner, units, notifications, quietHours, quietStart, quietEnd]);

  const signInForm = useForm<SignInInput>({ resolver: zodResolver(signInSchema) });
  const signUpForm = useForm<SignUpInput>({ resolver: zodResolver(signUpSchema) });

  async function submitSignIn(values: SignInInput) {
    setAuthFailed(false);
    try {
      await auth.signIn(values.email, values.password);
      setAuthMessage("You’re signed in. Your account data is protected by Supabase row-level security; local demo data is not uploaded.");
      signInForm.reset();
    } catch (error) {
      setAuthFailed(true);
      setAuthMessage(error instanceof Error ? error.message : "Sign-in failed. Please try again.");
    }
  }

  async function submitSignUp(values: SignUpInput) {
    setAuthFailed(false);
    try {
      const result = await auth.signUp(values.email, values.password, values.displayName);
      setAuthMessage(result.confirmationRequired
        ? "Account created. Check your email to confirm the address before signing in."
        : "Account created and signed in. Your local demo data has not been uploaded.");
      signUpForm.reset();
    } catch (error) {
      setAuthFailed(true);
      setAuthMessage(error instanceof Error ? error.message : "Account registration failed. Please try again.");
    }
  }

  async function signOut() {
    try {
      await auth.signOut();
      setAuthMessage("You’ve been signed out. Local demo data remains only in this browser.");
    } catch (error) {
      setAuthFailed(true);
      setAuthMessage(error instanceof Error ? error.message : "Sign-out failed. Please try again.");
    }
  }

  async function exportData() {
    try {
      const exportData = auth.user && !isDemoMode
        ? await exportUserData()
        : { exportType: "browser-local-demo", exportedAt: new Date().toISOString(), plants, discoveries };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = auth.user && !isDemoMode ? "plant-ai-account-export.json" : "plant-ai-demo-export.json";
      anchor.click();
      URL.revokeObjectURL(url);
      setExportFailed(false);
      setMessage(auth.user && !isDemoMode ? "Account data export downloaded." : "Local demo data export downloaded.");
    } catch (error) {
      console.error("Could not export data.", error);
      setExportFailed(true);
      setMessage(error instanceof Error ? error.message : "Export failed. No file was created.");
    }
  }
  function deleteData() {
    try {
      clearDemoData();
      localStorage.removeItem(SETTINGS_STORAGE_KEY);
      setMessage("Demo plants and discoveries were deleted from this browser.");
      setConfirmDelete(false);
    } catch (error) {
      console.error("Could not delete local demo data.", error);
      setMessage("We couldn’t delete the local demo data. Nothing was changed.");
      setConfirmDelete(false);
    }
  }

  async function deleteAccount() {
    if (!accountPassword) {
      setAccountDeleteError("Enter your password to confirm account deletion.");
      return;
    }
    setDeletingAccount(true);
    setAccountDeleteError("");
    try {
      await auth.reauthenticate(accountPassword);
      await requestAccountDeletion();
      setAccountPassword("");
      setConfirmAccountDelete(false);
      setMessage("Your account deletion request completed.");
    } catch (error) {
      console.error("Account deletion failed.", error);
      setAccountDeleteError(error instanceof Error ? error.message : "Account deletion could not be completed.");
    } finally {
      setDeletingAccount(false);
    }
  }
  return <><PageHeader eyebrow="YOUR ACCOUNT" title="Profile & settings" description={isDemoMode ? "Local demo preferences stay in this browser." : "Manage your Supabase account and local demo preferences."} /><div className="settings-layout"><section className="panel settings-card">
    <div className="settings-user"><div className="avatar avatar-large">{auth.user?.email?.slice(0, 1).toUpperCase() ?? "S"}</div><div><h2>{auth.user?.email ?? "Sam’s garden"}</h2><p>{auth.user ? "Authenticated Supabase account" : "Guest · browser-local demo data"}</p></div>{auth.user && <button className="button-secondary button-small" onClick={() => void signOut()}><LogOut size={14} /> Sign out</button>}</div>
    {auth.configured && !auth.user && <section className="auth-panel" aria-labelledby="cloud-account-title"><div className="section-heading"><div><p className="eyebrow">CLOUD ACCOUNT</p><h2 id="cloud-account-title">Your garden, with an account</h2></div></div><p className="subtle">Create an account or sign in. Local demo plants and discoveries are not uploaded or merged.</p><div className="view-switch" role="tablist" aria-label="Account access"><button type="button" role="tab" aria-selected={authMode === "sign-in"} onClick={() => { setAuthMode("sign-in"); setAuthMessage(""); }}>Sign in</button><button type="button" role="tab" aria-selected={authMode === "sign-up"} onClick={() => { setAuthMode("sign-up"); setAuthMessage(""); }}>Create account</button></div>
      {authMode === "sign-in" ? <form className="auth-form" onSubmit={signInForm.handleSubmit(submitSignIn)}><label>Email<input type="email" autoComplete="email" {...signInForm.register("email")} /></label>{signInForm.formState.errors.email && <p className="field-error" role="alert">{signInForm.formState.errors.email.message}</p>}<label>Password<input type="password" autoComplete="current-password" {...signInForm.register("password")} /></label>{signInForm.formState.errors.password && <p className="field-error" role="alert">{signInForm.formState.errors.password.message}</p>}<button className="button-primary" disabled={signInForm.formState.isSubmitting || auth.loading}><LogIn size={15} /> {signInForm.formState.isSubmitting ? "Signing in…" : "Sign in"}</button></form>
        : <form className="auth-form" onSubmit={signUpForm.handleSubmit(submitSignUp)}><label>Name<input autoComplete="name" {...signUpForm.register("displayName")} /></label>{signUpForm.formState.errors.displayName && <p className="field-error" role="alert">{signUpForm.formState.errors.displayName.message}</p>}<label>Email<input type="email" autoComplete="email" {...signUpForm.register("email")} /></label>{signUpForm.formState.errors.email && <p className="field-error" role="alert">{signUpForm.formState.errors.email.message}</p>}<label>Password<input type="password" autoComplete="new-password" {...signUpForm.register("password")} /></label>{signUpForm.formState.errors.password && <p className="field-error" role="alert">{signUpForm.formState.errors.password.message}</p>}<button className="button-primary" disabled={signUpForm.formState.isSubmitting || auth.loading}><LogIn size={15} /> {signUpForm.formState.isSubmitting ? "Creating account…" : "Create account"}</button></form>}
      {(authMessage || auth.error) && <p className={authFailed || auth.error ? "field-error" : "settings-message"} role={authFailed || auth.error ? "alert" : "status"}>{auth.error || authMessage}</p>}
    </section>}
    {auth.configured && auth.user && <div className="account-connected-note"><ShieldCheck size={16} /><span>Signed in to Supabase as <strong>{auth.user.email}</strong>. Browser-local demo plants remain separate and are never synced automatically. The existing garden screens have not yet been switched to the cloud repository.</span></div>}
    <div className="setting-row"><div className="setting-icon"><Leaf size={18} /></div><div><strong>Measurement units</strong><p>Choose a display preference.</p></div><select aria-label="Measurement units" value={units} onChange={(event) => { const value = event.target.value; if (value === "metric" || value === "imperial") setUnits(value); }}><option value="metric">Metric</option><option value="imperial">Imperial</option></select></div>
    <div className="setting-row"><div className="setting-icon"><ShieldCheck size={18} /></div><div><strong>Care notifications</strong><p>Preference only; the app does not schedule reminders yet. Browser notifications are not guaranteed while the app is closed.</p></div><button className={`toggle ${notifications ? "toggle-on" : ""}`} aria-pressed={notifications} aria-label="Toggle care notifications preference" onClick={() => setNotifications((value) => !value)}><span /></button></div>
    <div className="setting-row"><div className="setting-icon"><Leaf size={18} /></div><div><strong>Quiet hours preference</strong><p>Saved as a preference only; no background or closed-app reminders are sent.</p></div><button className={`toggle ${quietHours ? "toggle-on" : ""}`} aria-pressed={quietHours} aria-label="Toggle quiet hours preference" onClick={() => setQuietHours((value) => !value)}><span /></button></div>
    {quietHours && <div className="quiet-hours"><label>Quiet hours start <input type="time" required value={quietStart} onChange={(event) => setQuietStart(event.target.value)} /></label><label>Quiet hours end <input type="time" required value={quietEnd} onChange={(event) => setQuietEnd(event.target.value)} /></label><span>Preference only. Reminders are not sent while the app is open or closed.</span></div>}
    <div className="setting-row"><div className="setting-icon"><ShieldCheck size={18} /></div><div><strong>Privacy</strong><p>{auth.user && !isDemoMode ? "Account records are protected by owner-scoped database policies; demo content remains local." : "Demo data is held in browser local storage only."}</p></div><span className="health-tag health-good">{auth.user && !isDemoMode ? "RLS protected" : "Local only"}</span></div>
    <div className="setting-row"><div className="setting-icon"><Download size={18} /></div><div><strong>Export your data</strong><p>{auth.user && !isDemoMode ? "Download account records visible to your signed-in session." : "Download the current browser-local demo collection as JSON."}</p></div><button className="button-secondary button-small" onClick={() => void exportData()}><Download size={14} /> Export</button></div>
    <div className="setting-row"><div className="setting-icon"><Trash2 size={18} /></div><div><strong>Delete demo data</strong><p>Remove saved plants and discoveries from this browser.</p></div><button className="button-quiet button-small" onClick={() => setConfirmDelete(true)}>Delete…</button></div>
    {message && <p className="settings-message" role="status">{message}</p>}
    {exportFailed && <ErrorState title="Export didn’t work" retry={exportData} />}
    {auth.configured && auth.user && <div className="setting-row account-delete-row"><div className="setting-icon"><Trash2 size={18} /></div><div><strong>Delete cloud account</strong><p>Requires your password and recent server verification; account-owned rows and private photos are removed by a Supabase Edge Function.</p></div><button className="button-danger" onClick={() => { setAccountDeleteError(""); setAccountPassword(""); setConfirmAccountDelete(true); }}>Delete account…</button></div>}
  </section><aside className="panel account-card"><div className="icon-badge"><ShieldCheck size={19} /></div><h2>{auth.configured ? "Private, authenticated access" : "Local demo mode"}</h2><p>{auth.configured ? "Cloud account CRUD is available only after sign-in. Supabase enforces row-level ownership for every private record and photo." : "No Supabase credentials are configured. Your guest garden lives only in browser storage; it is not a cloud account or backup."}</p><p className="subtle">Account deletion requires server-side privileges and is implemented by an authenticated Edge Function. The service-role key is never sent to the browser.</p></aside></div>
  {confirmDelete && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmDelete(false); }}><section ref={deleteDialogRef} className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" tabIndex={-1}><p className="eyebrow">LOCAL DEMO DATA</p><h2 id="delete-title">Delete saved demo data?</h2><p className="subtle">This removes plants and discoveries stored in this browser. It cannot be undone.</p><div className="dialog-actions"><button className="button-secondary" onClick={() => setConfirmDelete(false)}>Keep my data</button><button className="button-danger" onClick={deleteData}>Delete local data</button></div></section></div>}
  {confirmAccountDelete && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deletingAccount) setConfirmAccountDelete(false); }}><section ref={accountDeleteDialogRef} className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-account-title" tabIndex={-1}><p className="eyebrow">CLOUD ACCOUNT</p><h2 id="delete-account-title">Permanently delete your account?</h2><p className="subtle">This irreversible action deletes your Supabase Auth user, owned database records, and private plant photos. Your browser-local demo data is separate. Confirm with your account password; your sign-in must be recent.</p><label>Password<input type="password" autoComplete="current-password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} disabled={deletingAccount} /></label>{accountDeleteError && <p className="field-error" role="alert">{accountDeleteError}</p>}<div className="dialog-actions"><button className="button-secondary" disabled={deletingAccount} onClick={() => setConfirmAccountDelete(false)}>Cancel</button><button className="button-danger" disabled={deletingAccount || !accountPassword} onClick={() => void deleteAccount()}>{deletingAccount ? "Deleting…" : "Delete cloud account"}</button></div></section></div>}
  </>;
}

export function identifyDemoDiscovery(): Omit<Discovery, "id" | "savedAt" | "source"> {
  return { commonName: "Monstera", scientificName: "Monstera deliciosa", imageUrl: "https://images.unsplash.com/photo-1614594975525-e45190c55d0b?auto=format&fit=crop&w=900&q=85" };
}
