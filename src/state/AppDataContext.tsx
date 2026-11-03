import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  AppData,
  CareEvent,
  CareEventType,
  CareTask,
  CareTaskType,
  Discovery,
  DoctorAnswers,
  DoctorAssessment,
  GrowthCheck,
  GrowthConfirmation,
  GrowthObservation,
  GrowthPhoto,
  IssueEpisode,
  IssueFollowUp,
  Plant,
  PlantCondition,
  SoilMoisture,
  Symptom,
} from "../domain/types";
import { careIntervalBounds, initialSoilCheckDueAt, type CareScheduleRecommendation } from "../domain/care";
import { initialDemoData } from "../data/demo";
import { createCareTask as createCloudCareTask, completeCloudCareTask, createCareEvent, createCloudGrowthCheck, createCloudIssueEpisode, createCloudIssueFollowUp, createPlant as createCloudPlant, deletePlant as deleteCloudPlant, loadCloudAppData, loadCloudCareTasks, loadCloudMonitoringData, recordCloudCareCheck, updateCareTask as updateCloudCareTask, updateCloudGrowthConfirmation, updatePlant as updateCloudPlant } from "../data/cloudRepository";
import { loadDemoData, saveDemoData } from "../data/persistence";
import { useOptionalAuth } from "../data/AuthContext";

type CloudState = "local" | "loading" | "ready" | "error";

interface AppDataContextValue extends AppData {
  careTasks: CareTask[];
  issueEpisodes: IssueEpisode[];
  growthChecks: GrowthCheck[];
  cloudState: CloudState;
  cloudError: string;
  addDiscovery: (discovery: Omit<Discovery, "id" | "savedAt" | "source"> & { source?: Discovery["source"] }) => Discovery;
  addPlantFromDiscovery: (discoveryId: string) => Promise<Plant | undefined>;
  addEvent: (plantId: string, type: CareEventType, note: string) => Promise<void>;
  updatePlant: (plantId: string, changes: Partial<Pick<Plant, "name" | "location" | "light" | "health" | "wateringIntervalDays">> & {
    substrateType?: string;
    season?: NonNullable<Plant["environment"]>["season"] | null;
    potMaterial?: string;
    hasDrainage?: boolean | null;
  }) => Promise<void>;
  recordSoilCheck: (taskId: string, plant: Plant, soilMoisture: SoilMoisture, plantCondition: PlantCondition, action: "water" | "skip" | "inspect", recommendation: CareScheduleRecommendation) => Promise<void>;
  completeCareTask: (task: CareTask) => Promise<void>;
  skipCareTask: (task: CareTask) => Promise<void>;
  snoozeCareTask: (taskId: string, days: number) => Promise<void>;
  rescheduleCareTask: (taskId: string, dueAt: string) => Promise<void>;
  createCareTask: (plantId: string, type: CareTaskType, dueAt: string) => Promise<void>;
  addIssueEpisode: (input: {
    plantId: string | null;
    independent: boolean;
    symptom: Symptom;
    description: string;
    answers: DoctorAnswers;
    photos: { name: string; url: string; kind: "whole" | "close-up" }[];
    photoFiles?: File[];
    assessment: DoctorAssessment;
  }) => Promise<IssueEpisode>;
  addIssueFollowUp: (episodeId: string, note: string) => Promise<void>;
  addGrowthCheck: (input: {
    plantId: string;
    photos: GrowthPhoto[];
    photoUrl: string;
    photoName: string;
    previousPhotoUrl: string | null;
    previousCapturedAt: string | null;
    previousCheckId: string | null;
    previousPhotoId: string | null;
    photoFiles?: File[];
    note: string;
    observation: GrowthObservation;
    model: string;
  }) => Promise<GrowthCheck>;
  confirmGrowthCheck: (growthCheckId: string, confirmation: GrowthConfirmation, correction: string) => Promise<void>;
  removeDiscovery: (discoveryId: string) => void;
  clearDemoData: () => void;
  retryCloudLoad: () => void;
}

const AppDataContext = createContext<AppDataContextValue | undefined>(undefined);
const DAY_MS = 24 * 60 * 60 * 1000;

function makeInitialTask(plant: Plant, now = new Date()): CareTask {
  return {
    id: crypto.randomUUID(),
    plantId: plant.id,
    type: "soil_check",
    title: "Check soil moisture",
    notes: "Check the soil and plant condition before watering.",
    dueAt: initialSoilCheckDueAt(plant, now),
    status: "pending",
    completedAt: null,
    skippedAt: null,
    snoozedUntil: null,
  };
}

function localDataWithTasks(): AppData {
  const data = loadDemoData(initialDemoData);
  const careTasks = data.careTasks ?? [];
  const tasks = [...careTasks];
  for (const plant of data.plants) {
    if (!tasks.some((task) => task.plantId === plant.id && task.type === "soil_check" && task.status === "pending")) {
      tasks.push(makeInitialTask(plant));
    }
  }
  return { ...data, careTasks: tasks };
}

function updateTaskState(tasks: CareTask[], taskId: string, changes: Partial<CareTask>): CareTask[] {
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index < 0) throw new Error("This care task is no longer available. Refresh the page and try again.");
  return tasks.map((task) => task.id === taskId ? { ...task, ...changes } : task);
}

function eventForTask(task: CareTask, outcome: "completed" | "skipped", at: string): CareEvent {
  const type: CareEventType = outcome === "skipped" || task.type === "seasonal_review" || task.type === "soil_check"
    ? "observation"
    : task.type;
  const note = outcome === "skipped"
    ? `${task.title} skipped by the user.`
    : task.type === "seasonal_review"
      ? "Seasonal care review completed."
      : `${task.title} completed after user confirmation.`;
  return { id: crypto.randomUUID(), type, date: at, note };
}

function taskTitle(type: CareTaskType): string {
  const titles: Record<CareTaskType, string> = {
    soil_check: "Check soil moisture",
    feed: "Feed plant",
    prune: "Prune plant",
    repot: "Repot plant",
    seasonal_review: "Seasonal care review",
  };
  return titles[type];
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const auth = useOptionalAuth();
  const [data, setData] = useState<AppData>(() => localDataWithTasks());
  const dataRef = useRef(data);
  const [cloudState, setCloudState] = useState<CloudState>("local");
  const [cloudError, setCloudError] = useState("");
  const [cloudOwner, setCloudOwner] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const isCloudReady = Boolean(auth?.user?.id && auth.user.id === cloudOwner && cloudState === "ready");

  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => {
    if (!auth?.user?.id) {
      setCloudOwner("");
      setCloudState("local");
      setCloudError("");
      const local = localDataWithTasks();
      dataRef.current = local;
      setData(local);
      return;
    }

    let active = true;
    const ownerId = auth.user.id;
    setCloudOwner("");
    setCloudState("loading");
    setCloudError("");
    dataRef.current = { plants: [], discoveries: dataRef.current.discoveries, careTasks: [] };
    setData(dataRef.current);
    void (async () => {
      const cloudData = await loadCloudAppData();
      let tasks = await loadCloudCareTasks();
      const monitoringData = await loadCloudMonitoringData();
      for (const plant of cloudData.plants) {
        if (!tasks.some((task) => task.plantId === plant.id && task.type === "soil_check" && task.status === "pending")) {
          const created = await createCloudCareTask({
            plantId: plant.id,
            type: "soil_check",
            title: "Check soil moisture",
            notes: "Check the soil and plant condition before watering.",
            dueAt: initialSoilCheckDueAt(plant),
          });
          tasks = [...tasks, created];
        }
      }
      if (!active) return;
      const merged: AppData = {
        ...cloudData,
        ...monitoringData,
        discoveries: [...cloudData.discoveries, ...dataRef.current.discoveries.filter((item) =>
          !cloudData.discoveries.some((saved) => saved.id === item.id),
        )],
        careTasks: tasks,
      };
      dataRef.current = merged;
      setData(merged);
      setCloudOwner(ownerId);
      setCloudState("ready");
    })().catch((error: unknown) => {
      if (!active) return;
      console.error("Could not load account garden and care schedule.", error);
      setCloudError(error instanceof Error ? error.message : "Could not load the account garden.");
      setCloudState("error");
    });
    return () => { active = false; };
  }, [auth?.user?.id, reloadToken]);

  useEffect(() => {
    if (cloudState !== "local" || auth?.user?.id) return;
    saveDemoData(data);
  }, [auth?.user?.id, cloudState, data]);

  const setCurrentData = useCallback((next: AppData) => {
    dataRef.current = { ...next, issueEpisodes: next.issueEpisodes ?? [], growthChecks: next.growthChecks ?? [] };
    setData(dataRef.current);
  }, []);

  const addDiscovery = useCallback((input: Omit<Discovery, "id" | "savedAt" | "source"> & { source?: Discovery["source"] }) => {
    const discovery: Discovery = {
      ...input,
      id: crypto.randomUUID(),
      savedAt: new Date().toISOString(),
      source: input.source ?? "demo",
    };
    const current = dataRef.current;
    const next = { ...current, discoveries: [discovery, ...current.discoveries] };
    setCurrentData(next);
    if (cloudState === "ready") {
      const local = localDataWithTasks();
      saveDemoData({ ...local, discoveries: [discovery, ...local.discoveries] });
    }
    return discovery;
  }, [cloudState, setCurrentData]);

  const addPlantFromDiscovery = useCallback(async (discoveryId: string) => {
    const current = dataRef.current;
    const discovery = current.discoveries.find((item) => item.id === discoveryId);
    if (!discovery || discovery.plantId) return undefined;
    if (auth?.user?.id && isCloudReady) {
      const created = await createCloudPlant({
        nickname: discovery.commonName,
        commonName: discovery.commonName,
        scientificName: discovery.scientificName,
        location: "Choose a location",
        wateringIntervalDays: 7,
      });
      let task: CareTask;
      try {
        task = await createCloudCareTask({
          plantId: created.id,
          type: "soil_check",
          title: "Check soil moisture",
          notes: "Check the soil and plant condition before watering.",
          dueAt: initialSoilCheckDueAt(created),
        });
      } catch (error) {
        try {
          await deleteCloudPlant(created.id);
        } catch (rollbackError) {
          console.error("Plant setup failed and the new plant could not be rolled back.", rollbackError);
          const reason = error instanceof Error ? error.message : "care-task setup failed";
          throw new Error(`Plant setup failed (${reason}); the plant record could not be removed. Check your collection before retrying.`);
        }
        throw error;
      }
      const next = {
        ...dataRef.current,
        plants: [created, ...dataRef.current.plants],
        careTasks: [task, ...(dataRef.current.careTasks ?? [])],
        discoveries: dataRef.current.discoveries.map((item) => item.id === discoveryId ? { ...item, plantId: created.id } : item),
      };
      setCurrentData(next);
      return created;
    }
    const created: Plant = {
      id: crypto.randomUUID(),
      name: discovery.commonName,
      scientificName: discovery.scientificName,
      imageUrl: discovery.imageUrl,
      location: "Choose a location",
      health: "good",
      lastWatered: null,
      wateringIntervalDays: 7,
      light: "Not set",
      environment: {},
      events: [],
    };
    const next = {
      ...current,
      plants: [created, ...current.plants],
      careTasks: [makeInitialTask(created), ...(current.careTasks ?? [])],
      discoveries: current.discoveries.map((item) =>
        item.id === discoveryId ? { ...item, plantId: created.id } : item,
      ),
    };
    setCurrentData(next);
    return created;
  }, [auth?.user?.id, isCloudReady, setCurrentData]);

  const addEvent = useCallback(async (plantId: string, type: CareEventType, note: string) => {
    if (type === "water") throw new Error("Record watering only after confirming dry soil and usual plant condition.");
    if (auth?.user?.id && !isCloudReady) throw new Error("The account garden is not ready. Try again after it finishes loading.");
    const event: CareEvent = auth?.user?.id
      ? await createCareEvent(plantId, type, note)
      : { id: crypto.randomUUID(), type, note, date: new Date().toISOString() };
    const current = dataRef.current;
    setCurrentData({
      ...current,
      plants: current.plants.map((plant) => ({
        ...plant,
        events: plant.id === plantId ? [event, ...plant.events] : plant.events,
      })),
    });
  }, [auth?.user?.id, isCloudReady, setCurrentData]);

  const updatePlant = useCallback(async (plantId: string, changes: Parameters<AppDataContextValue["updatePlant"]>[1]) => {
    if (auth?.user?.id && !isCloudReady) throw new Error("The account garden is not ready. Try again after it finishes loading.");
    if (auth?.user?.id) await updateCloudPlant(plantId, changes);
    const current = dataRef.current;
    const plants = current.plants.map((plant) => plant.id === plantId ? {
      ...plant,
      ...changes,
      environment: {
        ...plant.environment,
        ...(changes.light ? { lightLevel: changes.light.toLowerCase().includes("bright") ? "bright" as const
          : changes.light.toLowerCase().includes("low") ? "low" as const
            : changes.light.toLowerCase().includes("medium") ? "medium" as const : undefined } : {}),
        ...(changes.substrateType !== undefined ? { substrate: changes.substrateType } : {}),
        ...(changes.season !== undefined ? { season: changes.season ?? undefined } : {}),
        ...(changes.potMaterial !== undefined ? { potMaterial: changes.potMaterial } : {}),
        ...(changes.hasDrainage !== undefined ? { hasDrainage: changes.hasDrainage ?? undefined } : {}),
      },
    } : plant);
    setCurrentData({ ...current, plants });
  }, [auth?.user?.id, isCloudReady, setCurrentData]);

  const recordSoilCheck = useCallback(async (
    taskId: string,
    plant: Plant,
    soilMoisture: SoilMoisture,
    plantCondition: PlantCondition,
    action: "water" | "skip" | "inspect",
    recommendation: CareScheduleRecommendation,
  ) => {
    if (auth?.user?.id && !isCloudReady) throw new Error("The account garden is not ready. Try again after it finishes loading.");
    const current = dataRef.current;
    const task = (current.careTasks ?? []).find((item) => item.id === taskId);
    if (!task || task.status !== "pending" || task.plantId !== plant.id) throw new Error("This soil-check task is no longer pending. Refresh and try again.");
    if (action === "water" && (soilMoisture !== "dry" || plantCondition !== "usual")) {
      throw new Error("Watering requires dry soil and a plant that looks usual.");
    }
    const { min, max } = careIntervalBounds(plant.environment?.careGuidance);
    if (!Number.isInteger(recommendation.nextIntervalDays) || recommendation.nextIntervalDays < min || recommendation.nextIntervalDays > max
      || !Number.isInteger(recommendation.nextCheckDays) || recommendation.nextCheckDays < 1 || recommendation.nextCheckDays > 60) {
      throw new Error("The proposed check schedule is outside the validated care range.");
    }
    const now = new Date();
    const date = now.toISOString();
    const outcome = action === "skip" ? "skipped" : "completed";
    const nextCheckDays = action === "inspect" ? 1 : recommendation.nextCheckDays;
    const dueAt = new Date(now.getTime() + nextCheckDays * DAY_MS).toISOString();
    const note = action === "water"
      ? "Watered after confirming dry soil and usual plant condition."
      : action === "skip"
        ? "Soil checked; skipped watering and scheduled another check."
        : "Soil and plant condition inspected; no watering was recorded.";
    const recommendationReason = [
      ...recommendation.why,
      ...(action !== recommendation.action ? [`You chose ${action === "skip" ? "to skip watering" : action === "inspect" ? "to inspect further" : "to water"} instead of the suggested action.`] : []),
      ...(action === "inspect" && recommendation.nextCheckDays !== 1 ? ["Because you chose to inspect further, the next check is scheduled for tomorrow."] : []),
    ].join(" ");
    if (auth?.user?.id) {
      const remote = await recordCloudCareCheck({
        taskId,
        soilMoisture,
        plantCondition,
        action,
        note,
        recommendationReason,
        nextIntervalDays: recommendation.nextIntervalDays,
        nextDueAt: dueAt,
      });
      setCurrentData({
        ...remote.data,
        discoveries: dataRef.current.discoveries,
        careTasks: remote.tasks,
      });
      return;
    }
    const event: CareEvent = {
      id: crypto.randomUUID(),
      type: action === "water" ? "water" : "observation",
      date,
      note,
      soilMoisture,
      plantCondition,
    };
    const nextTask: CareTask = {
      id: crypto.randomUUID(),
      plantId: plant.id,
      type: "soil_check",
      title: "Check soil moisture",
      notes: "Check the soil and plant condition before watering.",
      dueAt,
      status: "pending",
      completedAt: null,
      skippedAt: null,
      snoozedUntil: null,
    };
    const updatedTask = {
      ...task,
      status: outcome,
      completedAt: outcome === "completed" ? date : null,
      skippedAt: outcome === "skipped" ? date : null,
      notes: recommendationReason,
    } satisfies CareTask;
    setCurrentData({
      ...current,
      plants: current.plants.map((item) => item.id === plant.id ? {
        ...item,
        wateringIntervalDays: recommendation.nextIntervalDays,
        ...(action === "water" ? { lastWatered: date } : {}),
        events: [event, ...item.events],
      } : item),
      careTasks: [...updateTaskState(current.careTasks ?? [], taskId, updatedTask), nextTask],
    });
  }, [auth?.user?.id, isCloudReady, setCurrentData]);

  const settleGenericTask = useCallback(async (task: CareTask, outcome: "completed" | "skipped") => {
    if (auth?.user?.id && !isCloudReady) throw new Error("The account garden is not ready. Try again after it finishes loading.");
    if (auth?.user?.id) {
      const remote = await completeCloudCareTask(task.id, outcome, outcome === "completed" ? `${task.title} completed after user confirmation.` : `${task.title} skipped by the user.`);
      setCurrentData({ ...remote.data, discoveries: dataRef.current.discoveries, careTasks: remote.tasks });
      return;
    }
    const current = dataRef.current;
    const at = new Date().toISOString();
    const event = eventForTask(task, outcome, at);
    setCurrentData({
      ...current,
      plants: current.plants.map((plant) => plant.id === task.plantId ? { ...plant, events: [event, ...plant.events] } : plant),
      careTasks: updateTaskState(current.careTasks ?? [], task.id, {
        status: outcome,
        completedAt: outcome === "completed" ? at : null,
        skippedAt: outcome === "skipped" ? at : null,
        snoozedUntil: null,
      }),
    });
  }, [auth?.user?.id, isCloudReady, setCurrentData]);

  const snoozeCareTask = useCallback(async (taskId: string, days: number) => {
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error("Choose a snooze period from 1 to 30 days.");
    const until = new Date(Date.now() + days * DAY_MS).toISOString();
    if (auth?.user?.id && !isCloudReady) throw new Error("The account garden is not ready. Try again after it finishes loading.");
    const task = (dataRef.current.careTasks ?? []).find((item) => item.id === taskId);
    if (!task || task.status !== "pending") throw new Error("This care task is no longer pending.");
    if (auth?.user?.id) {
      const updated = await updateCloudCareTask(taskId, { snoozedUntil: until });
      setCurrentData({ ...dataRef.current, careTasks: updateTaskState(dataRef.current.careTasks ?? [], taskId, updated) });
      return;
    }
    setCurrentData({ ...dataRef.current, careTasks: updateTaskState(dataRef.current.careTasks ?? [], taskId, { snoozedUntil: until }) });
  }, [auth?.user?.id, isCloudReady, setCurrentData]);

  const rescheduleCareTask = useCallback(async (taskId: string, dueAt: string) => {
    const timestamp = new Date(dueAt).getTime();
    if (!Number.isFinite(timestamp) || timestamp < Date.now() || timestamp > Date.now() + 60 * DAY_MS) {
      throw new Error("Choose a future date within the next 60 days.");
    }
    if (auth?.user?.id && !isCloudReady) throw new Error("The account garden is not ready. Try again after it finishes loading.");
    const changes = { dueAt: new Date(timestamp).toISOString(), snoozedUntil: null, rescheduledAt: new Date().toISOString() };
    if (auth?.user?.id) {
      const updated = await updateCloudCareTask(taskId, changes);
      setCurrentData({ ...dataRef.current, careTasks: updateTaskState(dataRef.current.careTasks ?? [], taskId, updated) });
      return;
    }
    setCurrentData({ ...dataRef.current, careTasks: updateTaskState(dataRef.current.careTasks ?? [], taskId, changes) });
  }, [auth?.user?.id, isCloudReady, setCurrentData]);

  const createCareTask = useCallback(async (plantId: string, type: CareTaskType, dueAt: string) => {
    if (type === "soil_check") throw new Error("Use the scheduled soil-check task instead of adding a duplicate.");
    const plant = dataRef.current.plants.find((item) => item.id === plantId);
    if (!plant) throw new Error("Choose a plant in your garden.");
    const due = new Date(dueAt);
    if (!Number.isFinite(due.getTime()) || due.getTime() < Date.now() || due.getTime() > Date.now() + 60 * DAY_MS) {
      throw new Error("Choose a future task date within the next 60 days.");
    }
    const input = { plantId, type, title: taskTitle(type), notes: "Planned by you; check the plant and use your judgement.", dueAt: due.toISOString() };
    if (auth?.user?.id && !isCloudReady) throw new Error("The account garden is not ready. Try again after it finishes loading.");
    const task: CareTask = auth?.user?.id
      ? await createCloudCareTask(input)
      : {
        id: crypto.randomUUID(),
        ...input,
        status: "pending",
        completedAt: null,
        skippedAt: null,
        snoozedUntil: null,
      };
    setCurrentData({ ...dataRef.current, careTasks: [...(dataRef.current.careTasks ?? []), task] });
  }, [auth?.user?.id, isCloudReady, setCurrentData]);

  const removeDiscovery = useCallback((discoveryId: string) => {
    const current = dataRef.current;
    const discoveries = current.discoveries.filter((discovery) => discovery.id !== discoveryId);
    const next = { ...current, discoveries };
    setCurrentData(next);
    if (cloudState === "ready") {
      const local = localDataWithTasks();
      saveDemoData({ ...local, discoveries: local.discoveries.filter((discovery) => discovery.id !== discoveryId) });
    }
  }, [cloudState, setCurrentData]);

  const clearDemoData = useCallback(() => {
    const next: AppData = { plants: [], discoveries: [], careTasks: [] };
    saveDemoData(next);
    if (cloudState === "local") setCurrentData(next);
  }, [cloudState, setCurrentData]);

  const retryCloudLoad = useCallback(() => setReloadToken((token) => token + 1), []);
  const addIssueEpisode = useCallback(async (input: {
    plantId: string | null;
    independent: boolean;
    symptom: Symptom;
    description: string;
    answers: DoctorAnswers;
    photos: { name: string; url: string; kind: "whole" | "close-up" }[];
    photoFiles?: File[];
    assessment: DoctorAssessment;
  }): Promise<IssueEpisode> => {
    if (auth?.user?.id) {
      if (!isCloudReady) throw new Error("The account garden is not ready. Try again after it finishes loading.");
      const photoFiles = input.photoFiles ?? [];
      if (photoFiles.length !== input.photos.length) throw new Error("The selected issue photos could not be saved.");
      const episode = await createCloudIssueEpisode({
        plantId: input.plantId,
        independent: input.independent,
        symptom: input.symptom,
        description: input.description,
        answers: input.answers,
        photos: input.photos.map((photo, index) => ({ file: photoFiles[index], kind: photo.kind })),
        assessment: input.assessment,
      });
      setCurrentData({ ...dataRef.current, issueEpisodes: [episode, ...(dataRef.current.issueEpisodes ?? [])] });
      return episode;
    }
    const episode: IssueEpisode = {
      id: crypto.randomUUID(),
      plantId: input.plantId,
      independent: input.independent,
      title: input.plantId
        ? "Plant doctor assessment"
        : "Plant doctor assessment (independent)",
      symptom: input.symptom,
      description: input.description.trim(),
      answers: input.answers,
      photos: input.photos,
      assessment: input.assessment,
      followUps: [],
      startedAt: new Date().toISOString(),
    };
    const current = dataRef.current;
    setCurrentData({ ...current, issueEpisodes: [episode, ...(current.issueEpisodes ?? [])] });
    return episode;
  }, [auth?.user?.id, isCloudReady, setCurrentData]);

  const addIssueFollowUp = useCallback(async (episodeId: string, note: string) => {
    if (!note.trim() || note.trim().length > 2000) throw new Error("Write a follow-up between 1 and 2,000 characters.");
    if (auth?.user?.id) {
      if (!isCloudReady) throw new Error("The account garden is not ready. Try again after it finishes loading.");
      const followUp = await createCloudIssueFollowUp(episodeId, note);
      setCurrentData({
        ...dataRef.current,
        issueEpisodes: (dataRef.current.issueEpisodes ?? []).map((episode) => episode.id === episodeId
          ? { ...episode, followUps: [...episode.followUps, followUp] }
          : episode),
      });
      return;
    }
    const current = dataRef.current;
    const followUp: IssueFollowUp = { id: crypto.randomUUID(), note: note.trim(), observedAt: new Date().toISOString() };
    setCurrentData({
      ...current,
      issueEpisodes: (current.issueEpisodes ?? []).map((episode) => episode.id === episodeId ? { ...episode, followUps: [...episode.followUps, followUp] } : episode),
    });
  }, [auth?.user?.id, isCloudReady, setCurrentData]);

  const addGrowthCheck = useCallback(async (input: {
    plantId: string;
    photos: GrowthPhoto[];
    photoFiles?: File[];
    photoUrl: string;
    photoName: string;
    previousPhotoUrl: string | null;
    previousCapturedAt: string | null;
    previousCheckId: string | null;
    previousPhotoId: string | null;
    note: string;
    observation: GrowthObservation;
    model: string;
  }): Promise<GrowthCheck> => {
    if (auth?.user?.id) {
      if (!isCloudReady) throw new Error("The account garden is not ready. Try again after it finishes loading.");
      const photoFiles = input.photoFiles ?? [];
      if (photoFiles.length !== input.photos.length) throw new Error("The selected growth photos could not be saved.");
      const growthCheck = await createCloudGrowthCheck({
        plantId: input.plantId,
        photos: photoFiles,
        previousCheckId: input.previousCheckId,
        previousPhotoId: input.previousPhotoId,
        previousCapturedAt: input.previousCapturedAt,
        note: input.note,
        observation: input.observation,
      });
      setCurrentData({ ...dataRef.current, growthChecks: [growthCheck, ...(dataRef.current.growthChecks ?? [])] });
      return growthCheck;
    }
    const growthCheck: GrowthCheck = {
      id: crypto.randomUUID(),
      plantId: input.plantId,
      photoUrl: input.photoUrl,
      photoName: input.photoName,
      photos: input.photos,
      previousPhotoUrl: input.previousPhotoUrl,
      previousCapturedAt: input.previousCapturedAt,
      note: input.note,
      observation: input.observation,
      userConfirmation: "not_confirmed",
      userCorrection: "",
      model: input.model,
      capturedAt: new Date().toISOString(),
    };
    const current = dataRef.current;
    setCurrentData({ ...current, growthChecks: [growthCheck, ...(current.growthChecks ?? [])] });
    return growthCheck;
  }, [auth?.user?.id, isCloudReady, setCurrentData]);

  const confirmGrowthCheck = useCallback(async (growthCheckId: string, confirmation: GrowthConfirmation, correction: string) => {
    const text = correction.trim();
    if (confirmation === "corrected" && !text) throw new Error("Add a correction before selecting corrected.");
    if (text.length > 1000) throw new Error("Keep your correction under 1,000 characters.");
    if (auth?.user?.id) {
      if (!isCloudReady) throw new Error("The account garden is not ready. Try again after it finishes loading.");
      await updateCloudGrowthConfirmation(growthCheckId, confirmation, text);
    }
    const current = dataRef.current;
    setCurrentData({
      ...current,
      growthChecks: (current.growthChecks ?? []).map((item) => item.id === growthCheckId ? { ...item, userConfirmation: confirmation, userCorrection: text } : item),
    });
  }, [auth?.user?.id, isCloudReady, setCurrentData]);

  const value = useMemo<AppDataContextValue>(() => ({
    ...data,
    careTasks: data.careTasks ?? [],
    issueEpisodes: data.issueEpisodes ?? [],
    growthChecks: data.growthChecks ?? [],
    cloudState,
    cloudError,
    addDiscovery,
    addPlantFromDiscovery,
    addEvent,
    updatePlant,
    recordSoilCheck,
    completeCareTask: (task) => settleGenericTask(task, "completed"),
    skipCareTask: (task) => settleGenericTask(task, "skipped"),
    snoozeCareTask,
    rescheduleCareTask,
    createCareTask,
    addIssueEpisode,
    addIssueFollowUp,
    addGrowthCheck,
    confirmGrowthCheck,
    removeDiscovery,
    clearDemoData,
    retryCloudLoad,
  }), [
    data, cloudState, cloudError, addDiscovery, addPlantFromDiscovery, addEvent,
    updatePlant, recordSoilCheck, settleGenericTask, snoozeCareTask, rescheduleCareTask,
    createCareTask, addIssueEpisode, addIssueFollowUp, addGrowthCheck, confirmGrowthCheck,
    removeDiscovery, clearDemoData, retryCloudLoad,
  ]);

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataContextValue {
  const context = useContext(AppDataContext);
  if (!context) throw new Error("useAppData must be used within AppDataProvider.");
  return context;
}
