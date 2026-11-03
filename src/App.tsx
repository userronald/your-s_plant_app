import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { calculateCareSchedule, careTaskState } from "./domain/care";
import {
  ArrowRight, Bell, BookOpen, Check, CheckCircle2, ChevronDown,
  Droplets, Flower2, House, Leaf, MapPin, Menu, Plus, Search, ShieldCheck,
  Sprout, Sun, UserRound, X, HeartPulse, Images, MessageCircle,
} from "lucide-react";
import { observationSchema, type ObservationInput } from "./domain/validation";
import type { CareTask, CareTaskType, IssueEpisode, Plant, PlantCondition, SoilMoisture } from "./domain/types";
import type { IdentificationPhoto, IdentificationResultContract } from "./domain/identification";
import { createDemoIdentificationProvider, displayNameForCandidate } from "./domain/identification";
import { useAuth } from "./data/AuthContext";
import { isDemoMode } from "./data/env";
import { createLivePlantIdentificationProvider } from "./data/plantIdentification";
import { useAppData } from "./state/AppDataContext";
import { CareActionDialog, ConfidenceIndicator, EmptyState, PageHeader, PlantCard as SharedPlantCard, Timeline, useDialogFocus, useEscapeToClose } from "./components/PlantUi";
import { PlantIdentificationUploader } from "./components/PlantIdentificationUploader";
import { GrowthCheckPage, LocationGuidePage, PassportPage, PlantDoctorPage, PlantsCollectionPage, SettingsPage } from "./features/FeaturePages";
const PlantAssistantPage = lazy(() => import("./features/PlantAssistantPage").then((module) => ({ default: module.PlantAssistantPage })));

const navItems = [
  { to: "/", label: "Today", icon: House, end: true },
  { to: "/plants", label: "My plants", icon: Sprout },
  { to: "/scan", label: "Scan", icon: Search, prominent: true },
  { to: "/explore", label: "Explore", icon: BookOpen },
  { to: "/profile", label: "Profile", icon: UserRound },
];
const extraNavItems = [
  { to: "/passport", label: "Plant passport", icon: Images },
  { to: "/doctor", label: "Plant Doctor", icon: HeartPulse },
  { to: "/assistant", label: "Plant assistant", icon: MessageCircle },
];

function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const auth = useAuth();
  const { cloudState } = useAppData();
  const currentSection = pathname.startsWith("/plants") ? "My plants"
    : pathname.startsWith("/passport") ? "Plant passport"
      : pathname.startsWith("/doctor") ? "Plant Doctor"
        : pathname.startsWith("/assistant") ? "Plant assistant"
        : pathname.startsWith("/scan/growth") ? "Growth check-in"
          : pathname.startsWith("/scan/location") ? "Growing spot"
            : pathname.startsWith("/scan") ? "Scan"
      : pathname.startsWith("/explore") ? "Explore"
        : pathname.startsWith("/profile") ? "Profile" : "Today";
  return (
    <div className="min-h-screen bg-ivory text-ink">
      <aside className="sidebar hidden lg:flex">
        <Brand />
        <p className="section-label mt-12">YOUR SPACE</p>
        <nav className="mt-3 flex flex-col gap-1" aria-label="Main navigation">
          {navItems.map((item) => <NavigationItem key={item.to} item={item} />)}
        </nav>
        <p className="section-label mt-8">MORE TO EXPLORE</p>
        <nav className="mt-3 flex flex-col gap-1" aria-label="Plant tools">
          {extraNavItems.map((item) => <NavigationItem key={item.to} item={item} />)}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note"><Leaf size={17} /><span>A little care goes a long way.</span></div>
          <div className="profile-mini"><div className="avatar">S</div><div><strong>Sam’s garden</strong><small>Personal space</small></div><ChevronDown size={16} /></div>
        </div>
      </aside>
      <div className="min-h-screen lg:pl-[258px]">
        <header className="topbar">
          <div className="flex items-center gap-3">
            <button className="icon-button lg:hidden" aria-label="Toggle navigation" onClick={() => setMenuOpen(!menuOpen)}><Menu size={20} /></button>
            <span className="lg:hidden"><Brand compact /></span>
            <div className="hidden lg:block text-sm text-muted">Your growing space <span className="mx-2 text-line">/</span> <span className="text-ink">{currentSection}</span></div>
          </div>
          <div className="flex items-center gap-2">
            <span className="mode-pill"><span className="mode-dot" />{isDemoMode || !auth.user ? "Local demo" : auth.loading || cloudState === "loading" ? "Loading cloud garden…" : cloudState === "error" ? "Cloud garden unavailable" : "Cloud garden"}</span>
            <Link to="/profile" className="icon-button" aria-label="Notification preferences"><Bell size={18} /></Link>
            <div className="avatar hidden sm:grid">S</div>
          </div>
        </header>
        {menuOpen && <div className="mobile-drawer lg:hidden"><nav aria-label="Mobile navigation">{[...navItems, ...extraNavItems].map((item) => <NavigationItem key={item.to} item={item} onNavigate={() => setMenuOpen(false)} />)}</nav></div>}
        <main className="content"><Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/plants" element={<PlantsPage />} />
          <Route path="/plants/:plantId" element={<PlantDetailPage />} />
          <Route path="/passport" element={<PassportPage />} />
          <Route path="/doctor" element={<PlantDoctorPage />} />
          <Route path="/assistant" element={<Suspense fallback={<div className="care-cloud-status" role="status">Loading plant assistant…</div>}><PlantAssistantPage /></Suspense>} />
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/scan/growth" element={<GrowthCheckPage />} />
          <Route path="/scan/location" element={<LocationGuidePage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes></main>
      </div>
      <nav className="mobile-nav lg:hidden" aria-label="Mobile navigation">
        {navItems.map((item) => <NavigationItem key={item.to} item={item} />)}
      </nav>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <Link to="/" className={`brand ${compact ? "brand-compact" : ""}`} aria-label="Plant AI Companion home">
    <div className="brand-mark"><Flower2 size={20} strokeWidth={1.8} /></div>
    {!compact && <span>plant<span className="brand-light">kind</span></span>}
  </Link>;
}

function NavigationItem({ item, onNavigate }: { item: typeof navItems[number]; onNavigate?: () => void }) {
  const Icon = item.icon;
  return <NavLink to={item.to} end={item.end} onClick={onNavigate} className={({ isActive }) =>
    `nav-link ${item.prominent ? "nav-scan" : ""} ${isActive ? "nav-active" : ""}`}>
    <Icon size={19} strokeWidth={1.8} /><span>{item.label}</span>
  </NavLink>;
}

function TodayPage() {
  const {
    plants, careTasks, cloudState, cloudError, retryCloudLoad, recordSoilCheck,
    completeCareTask, skipCareTask, snoozeCareTask, rescheduleCareTask, createCareTask,
  } = useAppData();
  const [careSelection, setCareSelection] = useState<{ plant: Plant; task: CareTask } | null>(null);
  const [actionError, setActionError] = useState("");
  const [planningOpen, setPlanningOpen] = useState(false);
  const [plannedPlantId, setPlannedPlantId] = useState("");
  const [plannedType, setPlannedType] = useState<Exclude<CareTaskType, "soil_check">>("seasonal_review");
  const [plannedDate, setPlannedDate] = useState(() => toDateInputValue(new Date(Date.now() + 7 * 86400000)));
  const [rescheduleDate, setRescheduleDate] = useState<Record<string, string>>({});
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const pendingTasks = careTasks.filter((task) => task.status === "pending" && plants.some((plant) => plant.id === task.plantId));
  const upcomingTasks = pendingTasks.filter((task) => {
    const state = careTaskState(task, now);
    const dueTime = new Date(task.snoozedUntil ?? task.dueAt).getTime();
    return (state === "pending" || state === "snoozed") && dueTime >= endOfToday && dueTime <= now.getTime() + 7 * 86400000;
  });
  const attentionTasks = pendingTasks.filter((task) =>
    careTaskState(task, now) === "overdue"
    || ((careTaskState(task, now) === "pending" || careTaskState(task, now) === "snoozed")
      && new Date(task.snoozedUntil ?? task.dueAt).getTime() < endOfToday),
  );
  const plantsWithoutDueCheck = plants.filter((plant) => !pendingTasks.some((task) =>
    task.plantId === plant.id && task.type === "soil_check" && careTaskState(task, now) === "overdue",
  ));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning, Sam." : hour < 18 ? "Good afternoon, Sam." : "Good evening, Sam.";

  async function handleSoilDecision(action: "water" | "skip" | "inspect", soil: SoilMoisture, condition: PlantCondition, recommendation: ReturnType<typeof calculateCareSchedule>) {
    if (!careSelection) return;
    setActionError("");
    try {
      await recordSoilCheck(careSelection.task.id, careSelection.plant, soil, condition, action, recommendation);
      setCareSelection(null);
    } catch (error) {
      console.error("Could not save the soil check.", error);
      setActionError(error instanceof Error ? error.message : "The soil check could not be saved. Please try again.");
    }
  }

  async function handleTaskAction(task: CareTask, outcome: "completed" | "skipped") {
    setActionError("");
    try {
      if (outcome === "completed") await completeCareTask(task);
      else await skipCareTask(task);
    } catch (error) {
      console.error("Could not update the care task.", error);
      setActionError(error instanceof Error ? error.message : "The care task could not be updated. Please try again.");
    }
  }

  async function handleSnooze(taskId: string) {
    setActionError("");
    try {
      await snoozeCareTask(taskId, 1);
    } catch (error) {
      console.error("Could not snooze the care task.", error);
      setActionError(error instanceof Error ? error.message : "The task could not be snoozed. Please try again.");
    }
  }

  async function handleReschedule(taskId: string) {
    const value = rescheduleDate[taskId];
    if (!value) {
      setActionError("Choose a new due date before rescheduling.");
      return;
    }
    setActionError("");
    try {
      await rescheduleCareTask(taskId, new Date(`${value}T12:00:00`).toISOString());
    } catch (error) {
      console.error("Could not reschedule the care task.", error);
      setActionError(error instanceof Error ? error.message : "The care task could not be rescheduled. Please try again.");
    }
  }

  async function handleCreatePlannedTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const plantId = plannedPlantId || plants[0]?.id;
    if (!plantId) {
      setActionError("Add a plant before creating a care task.");
      return;
    }
    setActionError("");
    try {
      await createCareTask(plantId, plannedType, new Date(`${plannedDate}T12:00:00`).toISOString());
      setPlanningOpen(false);
    } catch (error) {
      console.error("Could not create a care task.", error);
      setActionError(error instanceof Error ? error.message : "The care task could not be created. Please try again.");
    }
  }

  function renderTask(task: CareTask) {
    const plant = plants.find((item) => item.id === task.plantId);
    if (!plant) return null;
    return <CareTaskRow key={task.id} task={task} plant={plant} state={careTaskState(task, now)}
      onCheck={() => setCareSelection({ plant, task })}
      onComplete={() => void handleTaskAction(task, "completed")}
      onSkip={() => void handleTaskAction(task, "skipped")}
      onSnooze={() => void handleSnooze(task.id)}
      rescheduleValue={rescheduleDate[task.id] ?? ""}
      onRescheduleDate={(value) => setRescheduleDate((current) => ({ ...current, [task.id]: value }))}
      onReschedule={() => void handleReschedule(task.id)} />;
  }

  return <>
    <div className="welcome-row">
      <div><p className="eyebrow">{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(now).toUpperCase()}</p><p className="personal-greeting">{greeting}</p><h1>A good day to grow.</h1><p className="page-description">A little check-in is all your plants need.</p></div>
      <div className="weather-chip"><span className="weather-symbol"><Leaf size={18} /></span><div><strong>{attentionTasks.length} care tasks need a check-in</strong><small>{plants.length} plants in your collection</small></div></div>
    </div>
    {cloudState === "loading" && <div className="care-cloud-status" role="status">Loading your private garden and care tasks…</div>}
    {cloudState === "error" && <div className="care-cloud-error" role="alert"><strong>Your cloud garden could not be loaded.</strong><p>{cloudError}</p><button className="button-secondary button-small" onClick={retryCloudLoad}>Retry</button></div>}
    {actionError && <p className="field-error" role="alert">{actionError}</p>}
    {cloudState === "loading" || cloudState === "error" ? null : plants.length === 0 ? <EmptyState title="Your garden starts here" copy="Add a plant to get a thoughtful care plan and a place for its story." action={<Link className="button-primary" to="/scan"><Search size={17} /> Identify a plant</Link>} /> : <>
      <section className="attention-panel">
        <div className="attention-top"><div><div className="icon-badge"><Droplets size={19} /></div><div><p className="eyebrow">A QUICK CHECK-IN</p><h2>Today’s care tasks</h2></div></div><span className="count-badge">{attentionTasks.length}</span></div>
        <p className="attention-copy">Tasks are reminders to observe, not automatic watering instructions.</p>
        {attentionTasks.length === 0 ? <div className="no-attention"><CheckCircle2 size={18} /> Nothing due today. Check-in dates are guides, not watering commands.</div> :
          <div className="task-list">{attentionTasks.map(renderTask)}</div>}
        <div className="task-footnote"><ShieldCheck size={15} /> Water only after checking soil and condition. A missed reminder never means a plant was watered.</div>
      </section>
      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">UP NEXT</p><h2>Upcoming care</h2></div><button className="button-secondary button-small" onClick={() => setPlanningOpen((open) => !open)} aria-expanded={planningOpen}>Plan a care task</button></div>
        {planningOpen && <form className="care-task-planner" onSubmit={(event) => void handleCreatePlannedTask(event)}>
          <label>Plant<select value={plannedPlantId || plants[0]?.id || ""} onChange={(event) => setPlannedPlantId(event.target.value)} disabled={plants.length === 0}><option value="" disabled>Choose a plant</option>{plants.map((plant) => <option key={plant.id} value={plant.id}>{plant.name}</option>)}</select></label>
          <label>Task<select value={plannedType} onChange={(event) => setPlannedType(event.target.value as Exclude<CareTaskType, "soil_check">)}><option value="seasonal_review">Seasonal review</option><option value="feed">Feed plant</option><option value="prune">Prune plant</option><option value="repot">Repot plant</option></select></label>
          <label>Due date<input type="date" value={plannedDate} min={toDateInputValue(now)} max={toDateInputValue(new Date(now.getTime() + 60 * 86400000))} onChange={(event) => setPlannedDate(event.target.value)} required /></label>
          <button className="button-primary button-small" type="submit">Add task</button>
          <p className="subtle">Planning only: review the plant before feeding, pruning, or repotting. No treatment is assumed.</p>
        </form>}
        {upcomingTasks.length > 0 ? <div className="task-list">{upcomingTasks.map(renderTask)}</div> : <div className="quiet-card"><CheckCircle2 size={18} /><span>Nothing scheduled in the next week. Keep an eye on your plants and let the soil be your guide.</span></div>}
      </section>
      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">YOUR LITTLE CORNER</p><h2>Growing well</h2></div><Link to="/plants" className="text-link">See all plants <ArrowRight size={16} /></Link></div>
        <div className="plant-grid">{plants.slice(0, 3).map((plant) => <SharedPlantCard key={plant.id} plant={plant} nextTask={careTasks.find((task) => task.plantId === plant.id && task.type === "soil_check" && task.status === "pending")} />)}</div>
      </section>
      <section className="section-block coming-up">
        <div className="section-heading"><div><p className="eyebrow">ON THE HORIZON</p><h2>Next seven days</h2></div></div>
        {upcomingTasks.length > 0 ? <div className="upcoming-strip">{upcomingTasks.map((task) => {
          const plant = plants.find((item) => item.id === task.plantId);
          return <div key={task.id}><span className="upcoming-dot" /><span><strong>{plant?.name}</strong> · {task.title}</span><span className="upcoming-date">{formatDate(task.snoozedUntil ?? task.dueAt)}</span></div>;
        })}</div> : <div className="quiet-card"><CheckCircle2 size={18} /><span>No tasks are due in the next week.</span></div>}
      </section>
      <section className="section-block recent-activity"><div className="section-heading"><div><p className="eyebrow">LITTLE MOMENTS</p><h2>Recent care activity</h2></div><Link to="/passport" className="text-link">Open plant passport <ArrowRight size={15} /></Link></div>{plants.flatMap((plant) => plant.events.map((event) => ({ plant, event }))).sort((a, b) => b.event.date.localeCompare(a.event.date)).slice(0, 4).length ? <div className="recent-activity-list">{plants.flatMap((plant) => plant.events.map((event) => ({ plant, event }))).sort((a, b) => b.event.date.localeCompare(a.event.date)).slice(0, 4).map(({ plant, event }) => <Link key={event.id} to={`/plants/${plant.id}`}><span className="timeline-marker"><Leaf size={13} /></span><span><strong>{event.type === "observation" ? "Check-in" : event.type[0].toUpperCase() + event.type.slice(1)}</strong><small>{plant.name} · {event.note}</small></span><time>{formatDate(event.date)}</time></Link>)}</div> : <div className="quiet-card"><Leaf size={17} /> Your care moments will appear here as you log them.</div>}</section>
      <section className="all-good-strip"><CheckCircle2 size={18} /><span><strong>{plantsWithoutDueCheck.length} {plantsWithoutDueCheck.length === 1 ? "plant" : "plants"} without an overdue soil check</strong> — nice work showing up for them.</span></section>
    </>}
    {careSelection && <CareActionDialog plant={careSelection.plant} task={careSelection.task} onClose={() => setCareSelection(null)} onDecision={(action, soil, condition, recommendation) => void handleSoilDecision(action, soil, condition, recommendation)} />}
  </>;
}

function CareTaskRow({ task, plant, state, onCheck, onComplete, onSkip, onSnooze, rescheduleValue, onRescheduleDate, onReschedule }: {
  task: CareTask;
  plant: Plant;
  state: string;
  onCheck: () => void;
  onComplete: () => void;
  onSkip: () => void;
  onSnooze: () => void;
  rescheduleValue: string;
  onRescheduleDate: (value: string) => void;
  onReschedule: () => void;
}) {
  const soilTask = task.type === "soil_check";
  return <article className={`task-card ${state === "overdue" ? "task-overdue" : ""}`}>
    <img src={plant.imageUrl} alt="" className="task-image" />
    <div className="task-info"><Link to={`/plants/${plant.id}`} className="task-name">{plant.name}</Link><span>{task.title} · {plant.location}</span><small>{state === "overdue" ? "Overdue · no care is assumed" : state === "snoozed" ? `Snoozed until ${formatDate(task.snoozedUntil ?? task.dueAt)}` : `Due ${formatDate(task.dueAt)}`}</small></div>
    {soilTask ? <button className="button-primary button-small" onClick={onCheck}><Droplets size={15} /> Check soil</button> : <div className="task-actions"><button className="button-primary button-small" onClick={onComplete}>Confirm &amp; log</button><button className="button-quiet button-small" onClick={onSkip}>Skip</button></div>}
    <div className="care-task-controls"><button className="button-quiet button-small" onClick={onSnooze}>Snooze 1 day</button><details><summary>Reschedule</summary><div className="reschedule-control"><input aria-label={`New due date for ${plant.name}`} type="date" value={rescheduleValue} min={toDateInputValue(new Date())} max={toDateInputValue(new Date(Date.now() + 60 * 86400000))} onChange={(event) => onRescheduleDate(event.target.value)} /><button className="button-secondary button-small" onClick={onReschedule}>Save date</button></div></details></div>
  </article>;
}

function PlantsPage() {
  const { careTasks, cloudState, cloudError, retryCloudLoad, recordSoilCheck } = useAppData();
  const [selection, setSelection] = useState<{ plant: Plant; task: CareTask } | null>(null);
  const [error, setError] = useState("");
  async function saveDecision(action: "water" | "skip" | "inspect", soil: SoilMoisture, condition: PlantCondition, recommendation: ReturnType<typeof calculateCareSchedule>) {
    if (!selection) return;
    try {
      await recordSoilCheck(selection.task.id, selection.plant, soil, condition, action, recommendation);
      setSelection(null);
      setError("");
    } catch (careError) {
      console.error("Could not save the soil check.", careError);
      setError(careError instanceof Error ? careError.message : "The soil check could not be saved.");
    }
  }
  if (cloudState === "loading") return <div className="care-cloud-status" role="status">Loading your private garden…</div>;
  if (cloudState === "error") return <div className="care-cloud-error" role="alert"><strong>Your cloud garden could not be loaded.</strong><p>{cloudError}</p><button className="button-secondary button-small" onClick={retryCloudLoad}>Retry</button></div>;
  return <><PlantsCollectionPage onCare={(plant) => {
    const task = careTasks.find((item) => item.plantId === plant.id && item.type === "soil_check" && item.status === "pending");
    if (task) setSelection({ plant, task });
    else setError("No soil-check task is scheduled for this plant. Refresh the garden or try again shortly.");
  }} />{error && <p role="alert" className="field-error">{error}</p>}{selection && <CareActionDialog plant={selection.plant} task={selection.task} onClose={() => setSelection(null)} onDecision={(action, soil, condition, recommendation) => void saveDecision(action, soil, condition, recommendation)} />}</>;
}

function PlantDetailPage() {
  const { plantId = "" } = useParams();
  const { plants, careTasks, issueEpisodes, addEvent, updatePlant, recordSoilCheck } = useAppData();
  const plant = plants.find((item) => item.id === plantId);
  const [showObservation, setShowObservation] = useState(false);
  const [careSelection, setCareSelection] = useState<{ plant: Plant; task: CareTask } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState("");
  const [eventError, setEventError] = useState("");
  const editDialogRef = useRef<HTMLElement>(null);
  useDialogFocus(editDialogRef, editing);
  useEscapeToClose(() => { setEditing(false); setShowObservation(false); setCareSelection(null); });
  if (!plant) return <EmptyState title="Plant not found" copy="It may have been removed from your collection." action={<Link to="/plants" className="button-secondary">Back to My plants</Link>} />;
  const selectedPlant = plant;

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("nickname") ?? "").trim();
    const location = String(form.get("room") ?? "").trim();
    const light = String(form.get("light") ?? "").trim();
    const healthValue = String(form.get("health") ?? "");
    const substrateType = String(form.get("substrate") ?? "").trim();
    const potMaterial = String(form.get("potMaterial") ?? "").trim();
    const drainageValue = String(form.get("drainage") ?? "");
    const seasonValue = String(form.get("season") ?? "");
    if (name.length < 1 || name.length > 60 || location.length < 1 || location.length > 80
      || light.length > 100 || substrateType.length > 100 || potMaterial.length > 60
      || !isHealthStatus(healthValue)
      || !["unknown", "yes", "no"].includes(drainageValue)
      || !["", "spring", "summer", "autumn", "winter"].includes(seasonValue)) {
      setEditError("Check the nickname, room, care details, and interval limits.");
      return;
    }
    setEditError("");
    try {
      await updatePlant(selectedPlant.id, {
        name, location, light, health: healthValue,
        substrateType, potMaterial,
        hasDrainage: drainageValue === "unknown" ? null : drainageValue === "yes",
        season: seasonValue ? seasonValue as NonNullable<Plant["environment"]>["season"] : null,
      });
      setEditing(false);
    } catch (error) {
      console.error("Could not update plant profile.", error);
      setEditError(error instanceof Error ? error.message : "The plant profile could not be saved.");
    }
  }

  async function saveObservation(note: string) {
    setEventError("");
    try {
      await addEvent(selectedPlant.id, "observation", note);
      setShowObservation(false);
    } catch (error) {
      console.error("Could not save plant observation.", error);
      setEventError(error instanceof Error ? error.message : "The observation could not be saved.");
    }
  }

  async function saveSoilDecision(action: "water" | "skip" | "inspect", soil: SoilMoisture, condition: PlantCondition, recommendation: ReturnType<typeof calculateCareSchedule>) {
    if (!careSelection) return;
    setEventError("");
    try {
      await recordSoilCheck(careSelection.task.id, selectedPlant, soil, condition, action, recommendation);
      setCareSelection(null);
    } catch (error) {
      console.error("Could not save the soil check.", error);
      setEventError(error instanceof Error ? error.message : "The soil check could not be saved.");
    }
  }
  const soilTask = careTasks.find((task) => task.plantId === plant.id && task.type === "soil_check" && task.status === "pending");
  const soilTaskStatus = soilTask ? careTaskState(soilTask) : null;
  const nextSoilCheck = soilTask ? new Date(soilTask.snoozedUntil ?? soilTask.dueAt) : null;
  const plantIssues = issueEpisodes.filter((episode) => episode.plantId === plant.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return <>
    <Link to="/plants" className="back-link">← My plants</Link>
    <div className="detail-hero">
      <img src={plant.imageUrl} alt={plant.name} />
      <div className="detail-overlay"><p className="eyebrow">YOUR PLANT PROFILE</p><h1>{plant.name}</h1><p className="scientific">{plant.scientificName}</p><span className="detail-location"><MapPin size={15} /> {plant.location}</span></div>
    </div>
    <div className="detail-action-row"><div><span className={`health-tag health-${plant.health}`}>{plant.health === "good" ? "Looking good" : plant.health === "check" ? "Keep an eye on" : "Needs attention"}</span><p className="detail-light"><Sun size={14} /> {plant.light}</p></div><div className="flex gap-2"><button className="button-secondary" onClick={() => setEditing(true)}>Edit profile</button><button className="button-secondary" onClick={() => setShowObservation(true)}>Add observation</button><button className="button-primary" disabled={!soilTask} onClick={() => soilTask && setCareSelection({ plant, task: soilTask })}><Droplets size={16} /> Check soil before watering</button></div></div>
    {eventError && <p className="field-error" role="alert">{eventError}</p>}
    <div className="detail-columns">
      <section className="care-plan panel"><p className="eyebrow">CARE PLAN</p><h2>Care, at your pace</h2><p className="subtle">Use this as a gentle reminder, not a strict schedule.</p><div className="care-item"><span className="care-icon"><Droplets size={18} /></span><div><strong>Check soil before watering</strong><p>{plant.lastWatered ? `Last confirmed watering ${formatRelativeDate(plant.lastWatered)}. No reminder assumes a watering happened.` : "No watering is recorded yet. Inspect the soil before watering."}</p></div></div><div className="next-action"><strong>Next action</strong><span>{nextSoilCheck ? `Soil check ${soilTaskStatus === "overdue" ? "was due" : "is due"} ${formatDate(nextSoilCheck.toISOString())}.` : "No soil-check task is currently available."}</span><button className="button-secondary button-small" disabled={!soilTask} onClick={() => soilTask && setCareSelection({ plant, task: soilTask })}>Check soil</button></div></section>
      <section className="timeline panel"><div className="timeline-heading"><div><p className="eyebrow">THE STORY SO FAR</p><h2>Timeline</h2></div><button className="button-icon-small" aria-label="Add care event" onClick={() => setShowObservation(true)}><Plus size={18} /></button></div>
        <Timeline events={plant.events} />
        {plantIssues.length > 0 && <div className="issue-timeline"><h3>Plant Doctor episodes</h3>{plantIssues.map((episode: IssueEpisode) => <article key={episode.id}><strong>{episode.title}</strong><time>{new Date(episode.startedAt).toLocaleDateString()}</time><p>{episode.assessment.observedSymptoms.join(" · ")}</p>{episode.followUps.map((followUp) => <p key={followUp.id}><time>{new Date(followUp.observedAt).toLocaleDateString()}</time> · {followUp.note}</p>)}</article>)}</div>}
      </section>
    </div>
    <section className="section-block photo-history panel"><div className="section-heading"><div><p className="eyebrow">GROWING OVER TIME</p><h2>Photo history</h2></div><Link to="/scan/growth" className="text-link">Add a check-in <ArrowRight size={15} /></Link></div><p className="subtle">View dated photos and cautious visual observations in Growth Check. No calibrated measurements are provided.</p></section>
    {showObservation && <ObservationDialog plant={plant} onClose={() => setShowObservation(false)} onSave={(note) => void saveObservation(note)} error={eventError} />}
    {careSelection && <CareActionDialog plant={careSelection.plant} task={careSelection.task} onClose={() => setCareSelection(null)} onDecision={(action, soil, condition, recommendation) => void saveSoilDecision(action, soil, condition, recommendation)} />}
    {editing && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(false); }}><section ref={editDialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby="edit-profile-title" tabIndex={-1}><button className="dialog-close" onClick={() => setEditing(false)} aria-label="Close"><X size={18} /></button><p className="eyebrow">PLANT DETAILS</p><h2 id="edit-profile-title">Make it yours</h2><form className="edit-profile-form" onSubmit={(event) => void saveProfile(event)}><label>Nickname<input name="nickname" defaultValue={plant.name} required minLength={1} maxLength={60} /></label><label>Room or location<input name="room" defaultValue={plant.location} required maxLength={80} /></label><label>Light notes<input name="light" defaultValue={plant.light} maxLength={100} /></label><label>Substrate<input name="substrate" defaultValue={plant.environment?.substrate ?? ""} maxLength={100} /></label><label>Pot material<input name="potMaterial" defaultValue={plant.environment?.potMaterial ?? ""} maxLength={60} /></label><label>Drainage<select name="drainage" defaultValue={plant.environment?.hasDrainage === undefined ? "unknown" : plant.environment.hasDrainage ? "yes" : "no"}><option value="unknown">Unknown</option><option value="yes">Drainage holes</option><option value="no">No drainage holes</option></select></label><label>Season<select name="season" defaultValue={plant.environment?.season ?? ""}><option value="">Not specified</option><option value="spring">Spring</option><option value="summer">Summer</option><option value="autumn">Autumn</option><option value="winter">Winter</option></select></label><label>Health<select name="health" defaultValue={plant.health}><option value="good">Looking good</option><option value="check">Keep an eye on</option><option value="attention">Needs attention</option></select></label>{editError && <p className="field-error" role="alert">{editError}</p>}<div className="dialog-actions"><button type="button" className="button-secondary" onClick={() => setEditing(false)}>Cancel</button><button className="button-primary"><Check size={15} /> Save profile</button></div></form></section></div>}
  </>;
}

function ObservationDialog({ plant, onClose, onSave, error }: { plant: Plant; onClose: () => void; onSave: (note: string) => void; error?: string }) {
  useEscapeToClose(onClose);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ObservationInput>({ resolver: zodResolver(observationSchema) });
  const submit = (values: ObservationInput) => onSave(values.note);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="dialog" role="dialog" aria-modal="true" aria-labelledby="observation-title" tabIndex={-1}><button className="dialog-close" onClick={onClose} aria-label="Close"><X size={18} /></button><p className="eyebrow">A MOMENT WITH {plant.name.toUpperCase()}</p><h2 id="observation-title">What did you notice?</h2><p className="subtle">A new leaf, something you want to remember, or a small change.</p><form onSubmit={handleSubmit(submit)}><label htmlFor="observation-note">Your note</label><textarea id="observation-note" rows={4} placeholder="I noticed…" {...register("note")} />{errors.note && <p className="field-error">{errors.note.message}</p>}{error && <p className="field-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button-secondary" onClick={onClose}>Cancel</button><button className="button-primary" disabled={isSubmitting}><Check size={16} /> Save to timeline</button></div></form></section>
  </div>;
}

function ScanPage() {
  const [photos, setPhotos] = useState<IdentificationPhoto[]>([]);
  const [result, setResult] = useState<IdentificationResultContract | null>(null);
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState(0);
  const [commonNameCorrection, setCommonNameCorrection] = useState("");
  const [scientificNameCorrection, setScientificNameCorrection] = useState("");
  const [identificationError, setIdentificationError] = useState("");
  const [collectionError, setCollectionError] = useState("");
  const [identifying, setIdentifying] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const { addDiscovery, addPlantFromDiscovery } = useAppData();
  const auth = useAuth();
  const navigate = useNavigate();
  const provider = useMemo(
    () => isDemoMode ? createDemoIdentificationProvider() : createLivePlantIdentificationProvider(),
    [],
  );
  const selectedCandidate = result?.candidates[selectedCandidateIndex];
  const acceptedCommonName = selectedCandidate
    ? commonNameCorrection.trim() || displayNameForCandidate(selectedCandidate)
    : "";
  const acceptedScientificName = selectedCandidate
    ? scientificNameCorrection.trim() || selectedCandidate.scientificName
    : "";
  const resultPhotoUrl = useMemo(
    () => photos[0] ? URL.createObjectURL(photos[0].file) : "",
    [photos],
  );
  useEffect(() => () => {
    if (resultPhotoUrl) URL.revokeObjectURL(resultPhotoUrl);
  }, [resultPhotoUrl]);
  const wasCorrected = Boolean(selectedCandidate && (
    acceptedCommonName !== displayNameForCandidate(selectedCandidate)
    || acceptedScientificName !== selectedCandidate.scientificName
  ));

  function selectPhotos(nextPhotos: IdentificationPhoto[]) {
    setPhotos(nextPhotos);
    setResult(null);
    setSavedId(null);
    setIdentificationError("");
  }

  async function identify() {
    if (photos.length < 1 || photos.length > 5) {
      setIdentificationError("Choose between one and five photos of the same plant.");
      return;
    }
    if (provider.mode === "live" && !auth.user) {
      setIdentificationError("Sign in to use live identification. Demo results are not based on your photos.");
      return;
    }
    setIdentifying(true);
    setIdentificationError("");
    setResult(null);
    setSavedId(null);
    try {
      const identification = await provider.identify(photos);
      setResult(identification);
      setSelectedCandidateIndex(0);
      setCommonNameCorrection("");
      setScientificNameCorrection("");
    } catch (error) {
      console.error("Plant identification failed.", error);
      setIdentificationError(error instanceof Error ? error.message : "Plant identification failed. Try again.");
    } finally {
      setIdentifying(false);
    }
  }

  function saveDiscovery() {
    if (!result || !selectedCandidate || !acceptedCommonName || !acceptedScientificName || savedId) return;
    const discovery = addDiscovery({
      commonName: acceptedCommonName,
      scientificName: acceptedScientificName,
      imageUrl: "/plant-placeholder.svg",
      source: result.resultMode === "demo" ? "demo" : "plantnet",
      taxonomyIds: wasCorrected ? { gbif: null, powo: null } : selectedCandidate.taxonomy.externalIds,
      identification: {
        provider: result.provider,
        matchScore: selectedCandidate.matchScore,
        providerVersion: result.providerVersion,
        wasCorrected,
      },
    });
    setSavedId(discovery.id);
  }

  async function addToCollection() {
    if (!savedId) return;
    setCollectionError("");
    try {
      const plant = await addPlantFromDiscovery(savedId);
      if (plant) navigate(`/plants/${plant.id}`);
      else setCollectionError("This discovery is already in your plant collection.");
    } catch (error) {
      console.error("Could not add discovery to the garden.", error);
      setCollectionError(error instanceof Error ? error.message : "Could not add this plant to your garden.");
    }
  }

  return <>
    <PageHeader eyebrow="PLANT IDENTIFICATION" title="Let’s meet this plant." description="Add up to five clear photos of one plant. A live result is a useful lead, not a guaranteed identification." />
    <div className="scan-shortcuts" aria-label="Other plant tools"><Link to="/doctor"><HeartPulse size={17} /><span><strong>Diagnose a problem</strong><small>Organize symptoms and safe checks</small></span><ArrowRight size={15} /></Link><Link to="/scan/growth"><Images size={17} /><span><strong>Growth check-in</strong><small>Save a dated photo and note</small></span><ArrowRight size={15} /></Link><Link to="/scan/location"><Leaf size={17} /><span><strong>Explore a growing spot</strong><small>Browse light-based suggestions</small></span><ArrowRight size={15} /></Link></div>
    <div className="scan-layout">
      <section className="scan-card">
        <PlantIdentificationUploader onChange={selectPhotos} disabled={identifying} />
        <div className="scan-privacy"><ShieldCheck size={16} /><span>Photos are compressed in your browser and sent only after you select Identify. The app does not keep uploaded image bytes.</span></div>
        <button className="button-primary identification-submit" onClick={() => void identify()} disabled={photos.length === 0 || identifying}>
          {identifying ? "Identifying…" : provider.mode === "demo" ? "Preview demo result" : "Identify with Pl@ntNet"}
          {!identifying && <ArrowRight size={15} />}
        </button>
        {provider.mode === "live" && <p className="subtle plantnet-credit">Live identification is provided by Pl@ntNet. Results vary by species and photo quality; review the candidates before saving.</p>}
        {collectionError && <p className="field-error" role="alert">{collectionError}</p>}
      </section>
      <aside className="scan-side-note"><div className="icon-badge"><Leaf size={18} /></div><h3>A few photo tips</h3><ul><li>Focus on the same plant in each photo</li><li>Use clear, well-lit photos</li><li>Flowers and fruit can help distinguish similar species</li><li>One to five views can be sent together</li></ul>{provider.mode === "demo" ? <div className="demo-note"><span className="mode-dot" /> Demo mode is on <p>The demo adapter returns sample content without analyzing or scoring your photo.</p></div> : <div className="demo-note">Sign in is required for live identification. Photos are sent to Pl@ntNet only when you submit them.</div>}</aside>
    </div>
    {identificationError && <div className="identification-error" role="alert"><strong>Identification could not be completed</strong><p>{identificationError}</p><button className="button-secondary button-small" onClick={() => void identify()} disabled={identifying || photos.length === 0}>Try again <ArrowRight size={14} /></button></div>}
    {result && <section className="sample-result identification-result" aria-labelledby="identification-result-title">
      <div className={`sample-label ${result.resultMode === "demo" ? "demo-result-label" : ""}`}>
        <span className="mode-dot" />{result.resultMode === "demo" ? "DEMO RESULT · NOT IDENTIFIED FROM YOUR PHOTO" : "LIVE RESULT · PL@NTNET"}
      </div>
      <div className="identification-result-meta">
        <span>{result.provider} API {result.providerApiVersion}</span>
        <span>Provider-reported version: {result.providerVersion ?? "not reported"}</span>
        {result.resultMode === "live" && <span>Response time: {result.elapsedMs} ms</span>}
      </div>
      {result.resultMode === "demo" && <p className="demo-result-warning">This sample is not based on the selected photos. No match score is generated in demo mode.</p>}
      {result.decision === "ambiguous" && <p className="identification-uncertainty" role="status">These candidates need your review. Provider match scores are relative ranking signals—not probabilities or a guarantee of species-level accuracy. Consider adding a clear flower, fruit, or leaf photo.</p>}
      {result.decision === "no_candidates" && <p className="identification-uncertainty" role="status">No candidates were returned. Try another clear photo of the same plant.</p>}
      {selectedCandidate && <>
        <div className="identification-primary-candidate">
          <img src={resultPhotoUrl || "/plant-placeholder.svg"} alt="Selected plant photo" />
          <div>
            <p className="eyebrow">LEADING CANDIDATE · REVIEW BEFORE SAVING</p>
            <h2 id="identification-result-title">{acceptedCommonName}</h2>
            <p className="scientific">{acceptedScientificName}{selectedCandidate.authorship && !wasCorrected ? ` ${selectedCandidate.authorship}` : ""}</p>
            <ConfidenceIndicator score={selectedCandidate.matchScore} resultMode={result.resultMode} />
            <p className="subtle">Family: {selectedCandidate.taxonomy.family ?? "not provided"} · Genus: {selectedCandidate.taxonomy.genus ?? "not provided"}</p>
            <p className="subtle">GBIF ID: {selectedCandidate.taxonomy.externalIds.gbif ?? "not provided"} · POWO ID: {selectedCandidate.taxonomy.externalIds.powo ?? "not provided"}</p>
          </div>
        </div>
        <div className="identification-corrections">
          <label>Common name <input value={commonNameCorrection} onChange={(event) => setCommonNameCorrection(event.target.value)} maxLength={120} placeholder={displayNameForCandidate(selectedCandidate)} /></label>
          <label>Scientific name <input value={scientificNameCorrection} onChange={(event) => setScientificNameCorrection(event.target.value)} maxLength={200} placeholder={selectedCandidate.scientificName} /></label>
          {wasCorrected && <p className="subtle">Your correction will be saved. Provider taxonomy IDs are cleared when you change the scientific name.</p>}
        </div>
        {result.candidates.length > 1 && <fieldset className="identification-alternatives"><legend>Alternative candidates · choose the one you accept</legend>{result.candidates.map((candidate, index) => <label key={`${candidate.scientificName}-${index}`} className="identification-candidate-option"><input type="radio" name="accepted-plant-candidate" checked={selectedCandidateIndex === index} onChange={() => { setSelectedCandidateIndex(index); setCommonNameCorrection(""); setScientificNameCorrection(""); setSavedId(null); }} /><span><strong>{displayNameForCandidate(candidate)}</strong><small>{candidate.scientificName}</small></span>{candidate.matchScore === null ? <small>No score</small> : <small>{(candidate.matchScore * 100).toFixed(1)}% relative match score</small>}</label>)}</fieldset>}
        {savedId ? <div className="saved-discovery"><CheckCircle2 size={17} /><span>{result.resultMode === "demo" ? "Demo discovery saved to this browser." : "Discovery saved to this browser-local passport; it is not uploaded to your account."}</span><button className="button-primary button-small" onClick={() => void addToCollection()}>Add to My plants <ArrowRight size={15} /></button><Link className="button-secondary button-small" to="/passport">Open passport</Link></div>
          : <button className="button-primary" onClick={saveDiscovery} disabled={!acceptedCommonName || !acceptedScientificName}>{result.resultMode === "demo" ? "Save demo discovery" : "Save discovery"}</button>}
      </>}
      {result.resultMode === "live" && <div className="plantnet-credit-block"><a href="https://my.plantnet.org/" target="_blank" rel="noreferrer"><img src="https://my.plantnet.org/images/powered-by-plantnet-light.svg" alt="Powered by Pl@ntNet" /></a><p>The image-based plant species identification service used is based on the Pl@ntNet recognition API, regularly updated and accessible through <a href="https://my.plantnet.org/" target="_blank" rel="noreferrer">my.plantnet.org</a>.</p></div>}
    </section>}
  </>;
}

const explorePlants = [
  { name: "Monstera", latin: "Monstera deliciosa", trait: "A leafy climber that enjoys bright, indirect light.", image: "https://images.unsplash.com/photo-1614594975525-e45190c55d0b?auto=format&fit=crop&w=900&q=85" },
  { name: "Golden pothos", latin: "Epipremnum aureum", trait: "An adaptable trailing plant; let the soil dry slightly between waterings.", image: "https://images.unsplash.com/photo-1614594895304-fe7116ac3b58?auto=format&fit=crop&w=900&q=85" },
  { name: "Rubber plant", latin: "Ficus elastica", trait: "Glossy leaves and a preference for bright, filtered light.", image: "https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=900&q=85" },
];

function ExplorePage() {
  const [query, setQuery] = useState("");
  const results = useMemo(() => explorePlants.filter((plant) => `${plant.name} ${plant.latin}`.toLowerCase().includes(query.toLowerCase())), [query]);
  return <>
    <PageHeader eyebrow="A WORLD OF GREEN" title="Explore plants" description="Get to know the plants that make a space feel like yours." />
    <label className="search-field explore-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by common or scientific name" aria-label="Search plant knowledge" /></label>
    <div className="explore-grid">{results.map((plant) => <article className="knowledge-card" key={plant.latin}><img src={plant.image} alt={plant.name} /><div><p className="eyebrow">PLANT GUIDE · DEMO</p><h2>{plant.name}</h2><p className="scientific">{plant.latin}</p><p>{plant.trait}</p><Link to="/scan" className="text-link">Find this plant <ArrowRight size={15} /></Link></div></article>)}</div>
    {results.length === 0 && <EmptyState title="No plants found" copy="Try a common name or browse our sample guides." />}
    <p className="data-note"><span className="mode-dot" /> These starter plant guides are example content, not AI-generated advice.</p>
  </>;
}

function ProfilePage() {
  return <SettingsPage />;
}

function NotFoundPage() {
  return <EmptyState title="Nothing growing here" copy="This page may have moved. Head back to your garden." action={<Link to="/" className="button-primary">Back to Today</Link>} />;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(date));
}

function toDateInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function isHealthStatus(value: string): value is Plant["health"] {
  return value === "good" || value === "check" || value === "attention";
}

function formatRelativeDate(date: string): string {
  const elapsed = Math.floor((Date.now() - new Date(date).getTime()) / (24 * 60 * 60 * 1000));
  if (elapsed < 1) return "today";
  if (elapsed === 1) return "yesterday";
  return `${elapsed} days ago`;
}

export default function App() {
  return <AppShell />;
}
