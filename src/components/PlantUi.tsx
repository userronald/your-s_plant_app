import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode, type RefObject } from "react";
import { ArrowRight, Check, CircleAlert, Droplets, Leaf, Upload, X } from "lucide-react";
import { Link } from "react-router-dom";
import type { CareEvent, CareTask, Plant, PlantCondition, SoilMoisture } from "../domain/types";
import { calculateCareSchedule, careTaskState, type CareScheduleRecommendation } from "../domain/care";

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{action}</div>;
}

export function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
}

export function useDialogFocus(ref: RefObject<HTMLElement>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const element = ref.current;
    if (!element) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const getFocusable = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ));
    getFocusable(element)[0]?.focus();

    function containTabFocus(event: KeyboardEvent) {
      const root = ref.current;
      if (event.key !== "Tab" || !root) return;
      const items = getFocusable(root);
      if (!items.length) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    element.addEventListener("keydown", containTabFocus);
    return () => {
      element.removeEventListener("keydown", containTabFocus);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [enabled, ref]);
}

export function EmptyState({ title, copy, action }: { title: string; copy: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-illustration"><Leaf size={28} strokeWidth={1.5} /></div><h2>{title}</h2><p>{copy}</p>{action}</div>;
}

export function ErrorState({ title = "We couldn’t load this right now", retry }: { title?: string; retry: () => void }) {
  return <div className="error-state" role="alert"><CircleAlert size={20} /><div><strong>{title}</strong><p>Your data has not been changed. Please try again.</p><button className="button-secondary button-small" onClick={retry}>Try again <ArrowRight size={14} /></button></div></div>;
}

export function ConfidenceIndicator({ score, resultMode }: { score: number | null; resultMode: "live" | "demo" }) {
  const label = resultMode === "demo"
    ? "No score · demo result"
    : score === null ? "No provider score returned" : `${(score * 100).toFixed(1)}% provider match score`;
  const detail = resultMode === "demo"
    ? "This sample did not analyze your photo."
    : "Relative ranking signal—not a probability or general AI certainty.";
  return <div className="confidence-indicator" aria-label={`${label}. ${detail}`}><span className="confidence-mark" aria-hidden="true">?</span><span><strong>{label}</strong><small>{detail}</small></span></div>;
}

export function PlantPhotoUploader({ onChange, onFilesChange, onRemove, initialImage, label = "Add a plant photo", multiple = false }: {
  onChange: (file: File) => void;
  onFilesChange?: (files: File[]) => void;
  onRemove?: () => void;
  initialImage?: string;
  label?: string;
  multiple?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(initialImage ?? "");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  useEffect(() => () => { if (preview.startsWith("blob:")) URL.revokeObjectURL(preview); }, [preview]);

  function acceptFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Choose an image file to continue."); return; }
    if (file.size > 8 * 1024 * 1024) { setError("Choose an image smaller than 8 MB."); return; }
    setError("");
    setPreview(URL.createObjectURL(file));
    onChange(file);
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (multiple) {
      const valid = files.filter((file) => file.type.startsWith("image/") && file.size <= 8 * 1024 * 1024);
      if (valid.length !== files.length) setError("Choose image files smaller than 8 MB.");
      else setError("");
      if (valid.length) onFilesChange?.(valid);
    } else {
      acceptFile(files[0]);
    }
    event.target.value = "";
  }

  function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (multiple) {
      const files = Array.from(event.dataTransfer.files);
      const valid = files.filter((file) => file.type.startsWith("image/") && file.size <= 8 * 1024 * 1024);
      if (valid.length !== files.length) setError("Choose image files smaller than 8 MB.");
      else setError("");
      if (valid.length) onFilesChange?.(valid);
    } else {
      acceptFile(event.dataTransfer.files[0]);
    }
  }

  function removeImage() {
    setPreview("");
    setError("");
    if (inputRef.current) inputRef.current.value = "";
    onRemove?.();
  }

  return <div className={`photo-uploader ${dragging ? "photo-uploader-dragging" : ""}`}
    onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
    onDragOver={(event) => event.preventDefault()}
    onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
    onDrop={dropFile}>
    <input ref={inputRef} className="sr-only" type="file" accept="image/*" capture={multiple ? undefined : "environment"} multiple={multiple} onChange={selectFile} aria-label={label} aria-hidden="true" tabIndex={-1} />
    {preview && !multiple ? <div className="photo-preview"><img src={preview} alt="Selected plant photo preview" /><div><button type="button" className="button-secondary button-small" onClick={() => inputRef.current?.click()}><Upload size={14} /> Replace</button><button type="button" className="button-quiet button-small" onClick={removeImage}><X size={14} /> Remove</button></div></div> :
      <button type="button" className="photo-picker" onClick={() => inputRef.current?.click()}><Upload size={19} /><strong>{label}</strong><span>JPG, PNG or WEBP · up to 8 MB, or drop an image here</span></button>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>;
}

export function PlantCard({ plant, onAction, nextTask }: { plant: Plant; onAction?: (plant: Plant) => void; nextTask?: CareTask }) {
  const taskState = nextTask ? careTaskState(nextTask) : null;
  const scheduledCheck = nextTask ? new Date(nextTask.snoozedUntil ?? nextTask.dueAt) : null;
  const checkLabel = taskState === "overdue" ? "Soil check overdue"
    : taskState === "snoozed" && scheduledCheck ? `Check snoozed · ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(scheduledCheck)}`
      : scheduledCheck ? `Next check · ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(scheduledCheck)}`
        : "No soil check scheduled";
  const healthLabel = plant.health === "good" ? "Doing well" : plant.health === "check" ? "Keep an eye on" : "Needs attention";
  return <article className="plant-card">
    <Link to={`/plants/${plant.id}`} className="plant-card-link" aria-label={`Open ${plant.name} profile`}>
      <div className="plant-photo-wrap"><img src={plant.imageUrl} alt={plant.name} className="plant-photo" /><span className={`health-tag health-${plant.health}`}>{healthLabel}</span></div>
      <div className="plant-card-copy"><div><h3>{plant.name}</h3><p>{plant.scientificName}</p><p className="plant-location">{plant.location}</p><p className="plant-next-check">{checkLabel}</p></div></div>
    </Link>
    {onAction && <div className="plant-card-action"><button className="button-quiet button-small" onClick={() => onAction(plant)}><Droplets size={14} /> Check care</button></div>}
  </article>;
}

export function TaskCard({ plant, onComplete }: { plant: Plant; onComplete: () => void }) {
  return <div className="task-card"><img src={plant.imageUrl} alt="" className="task-image" /><div className="task-info"><Link to={`/plants/${plant.id}`} className="task-name">{plant.name}</Link><span>Soil check · {plant.location}</span></div><button className="button-primary button-small" onClick={onComplete}><Droplets size={15} /> Check soil</button></div>;
}

export function Timeline({ events }: { events: CareEvent[] }) {
  const labels: Record<CareEvent["type"], string> = { water: "Watered", feed: "Fed", prune: "Pruned", repot: "Repotted", observation: "Observation" };
  if (!events.length) return <p className="empty-timeline">Your plant’s story starts with its first check-in.</p>;
  return <ol className="timeline-list">{[...events].sort((a, b) => b.date.localeCompare(a.date)).map((event) => <li key={event.id}><span className={`timeline-marker marker-${event.type}`}>{event.type === "water" ? <Droplets size={13} /> : <Leaf size={13} />}</span><div><strong>{labels[event.type]}</strong><span className="timeline-date">{new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(event.date))}</span><p>{event.note}</p></div></li>)}</ol>;
}

export function CareActionDialog({ plant, task, onClose, onDecision }: {
  plant: Plant;
  task: CareTask;
  onClose: () => void;
  onDecision: (action: "water" | "skip" | "inspect", soil: SoilMoisture, condition: PlantCondition, recommendation: CareScheduleRecommendation) => void;
}) {
  useEscapeToClose(onClose);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef);
  const [soil, setSoil] = useState<SoilMoisture | "">("");
  const [leaves, setLeaves] = useState<"usual" | "changed" | "">("");
  const recommendation = soil && leaves ? calculateCareSchedule({
    currentIntervalDays: plant.wateringIntervalDays,
    soilMoisture: soil,
    plantCondition: leaves,
    environment: plant.environment,
    recentObservations: plant.events
      .filter((event) => event.soilMoisture)
      .slice(0, 4)
      .map((event) => ({ soilMoisture: event.soilMoisture!, intervalDays: plant.wateringIntervalDays })),
    missedCheckIn: careTaskState(task) === "overdue",
  }) : null;
  const mayWater = soil === "dry" && leaves === "usual";
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="dialog care-dialog" role="dialog" aria-modal="true" aria-labelledby="care-dialog-title" tabIndex={-1}>
      <button className="dialog-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
      <p className="eyebrow">A MOMENT WITH {plant.name.toUpperCase()}</p><h2 id="care-dialog-title">Let’s check before we act.</h2>
      <p className="subtle">This is a reminder, not a diagnosis. What do you notice?</p>
      <fieldset><legend>How does the soil feel?</legend><div className="choice-row">{[["dry", "Dry"], ["slightly_moist", "Slightly moist"], ["wet", "Wet"]].map(([value, text]) => <button type="button" key={value} aria-pressed={soil === value} className={`choice-chip ${soil === value ? "choice-selected" : ""}`} onClick={() => setSoil(value as SoilMoisture)}>{text}</button>)}</div></fieldset>
      <fieldset><legend>How does the plant look?</legend><div className="choice-row"><button type="button" aria-pressed={leaves === "usual"} className={`choice-chip ${leaves === "usual" ? "choice-selected" : ""}`} onClick={() => setLeaves("usual")}>As usual</button><button type="button" aria-pressed={leaves === "changed"} className={`choice-chip ${leaves === "changed" ? "choice-selected" : ""}`} onClick={() => setLeaves("changed")}>Something changed</button></div></fieldset>
      {recommendation && <div className="care-recommendation" role="status">
        <strong>{recommendation.action === "water" ? "Recommendation: Water" : recommendation.action === "skip" ? "Recommendation: Skip and recheck" : "Recommendation: Inspect further"}</strong>
        <p>Next soil check in about {recommendation.nextCheckDays} day{recommendation.nextCheckDays === 1 ? "" : "s"}.</p>
        <details open><summary>Why?</summary><ul>{recommendation.why.map((reason) => <li key={reason}>{reason}</li>)}</ul></details>
      </div>}
      <div className="care-choice-actions">
        <button className="button-primary" disabled={!recommendation || !mayWater} onClick={() => recommendation && soil && leaves && onDecision("water", soil, leaves, recommendation)}><Droplets size={15} /> Water</button>
        <button className="button-secondary" disabled={!recommendation} onClick={() => recommendation && soil && leaves && onDecision("skip", soil, leaves, recommendation)}>Skip and recheck</button>
        <button className="button-secondary" disabled={!recommendation} onClick={() => recommendation && soil && leaves && onDecision("inspect", soil, leaves, recommendation)}>Inspect further</button>
      </div>
      {!mayWater && soil && <p className="care-dialog-note">Water is available only when the soil is dry and the plant looks usual. No watering is logged unless you confirm it here.</p>}
      <p className="care-dialog-note"><Check size={13} /> Schedule guidance is bounded and adjusted from observations; no reminder is treated as a watering.</p>
    </section>
  </div>;
}
