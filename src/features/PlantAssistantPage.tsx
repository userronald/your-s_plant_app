import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ImagePlus, LoaderCircle, MessageCircle, Plus, RotateCcw, Send, Trash2, X } from "lucide-react";
import { ASSISTANT_FALLBACK, ASSISTANT_SUGGESTIONS, assistantContextSchema, needsPlantContext, type AssistantContext, type AssistantConversation, type AssistantMessage } from "../domain/assistant";
import { useAuth } from "../data/AuthContext";
import { useAppData } from "../state/AppDataContext";
import { clearPlantAssistantHistory, loadPlantAssistantConversation, loadPlantAssistantHistory, PlantAssistantError, sendPlantAssistantMessage } from "../data/plantAssistant";

type ConversationSummary = Pick<AssistantConversation, "id" | "title" | "updatedAt">;

function assistantContext(value: string, discoveries: ReturnType<typeof useAppData>["discoveries"], species: string): AssistantContext {
  if (value.startsWith("plant:")) return assistantContextSchema.parse({ kind: "owned_plant", id: value.slice(6) });
  if (value.startsWith("discovery:")) {
    const discovery = discoveries.find((item) => item.id === value.slice(10));
    if (!discovery) throw new Error("That saved discovery is no longer available.");
    return assistantContextSchema.parse({
      kind: "discovery",
      id: discovery.id,
      commonName: discovery.commonName,
      scientificName: discovery.scientificName,
      source: discovery.source,
      savedAt: discovery.savedAt,
    });
  }
  if (value === "species") return assistantContextSchema.parse({ kind: "species", scientificName: species });
  return assistantContextSchema.parse({ kind: "general" });
}

function contextLabel(context: AssistantContext, plants: ReturnType<typeof useAppData>["plants"]): string {
  if (context.kind === "owned_plant") return plants.find((plant) => plant.id === context.id)?.name ?? "Selected plant";
  if (context.kind === "discovery") return `${context.commonName} · saved discovery`;
  if (context.kind === "species") return context.scientificName;
  return "General question";
}

function localMessage(role: "user" | "assistant", content: string, response: AssistantMessage["response"] = null): AssistantMessage {
  return { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString(), response };
}

export function PlantAssistantPage() {
  const { plants, discoveries } = useAppData();
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const [contextSelection, setContextSelection] = useState("general");
  const [species, setSpecies] = useState("");
  const [message, setMessage] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [fallback, setFallback] = useState(false);
  const messageEnd = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const ownerIdRef = useRef<string | null>(userId);
  const activeRequest = useRef<AbortController | null>(null);
  const selectedContext = useMemo(() => {
    try {
      return assistantContext(contextSelection, discoveries, species);
    } catch {
      return null;
    }
  }, [contextSelection, discoveries, species]);

  useEffect(() => {
    messageEnd.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  useEffect(() => {
    if (ownerIdRef.current !== userId) {
      ownerIdRef.current = userId;
      activeRequest.current?.abort();
      activeRequest.current = null;
      setConversationId(null);
      setMessages([]);
      setHistory([]);
      setMessage("");
      setPhoto(null);
      setContextSelection("general");
      setError("");
      setHistoryError("");
      setFallback(false);
      if (imageInput.current) imageInput.current.value = "";
    }
    if (!userId || authLoading) {
      setHistory([]);
      return;
    }
    let active = true;
    setHistoryBusy(true);
    void loadPlantAssistantHistory().then((items) => {
      if (active) {
        setHistory(items);
        setHistoryError("");
      }
    }).catch((loadError: unknown) => {
      if (active) setHistoryError(loadError instanceof Error ? loadError.message : "Conversation history could not be loaded.");
    }).finally(() => {
      if (active) setHistoryBusy(false);
    });
    return () => { active = false; };
  }, [userId, authLoading]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    if (authLoading) {
      setError("Checking your sign-in before sending. Please try again in a moment.");
      return;
    }
    if (!user) {
      setMessages((current) => [...current, localMessage("user", text)]);
      setMessage("");
      setPhoto(null);
      if (imageInput.current) imageInput.current.value = "";
      return;
    }
    if (!selectedContext) {
      setError("Enter a species name or choose a plant context first.");
      return;
    }
    if (needsPlantContext(text) && selectedContext.kind === "general") {
      setError("This question may need your plant's context. Select one of your plants, choose a saved discovery, or rephrase as a general question.");
      return;
    }
    setBusy(true);
    setError("");
    setFallback(false);
    const controller = new AbortController();
    activeRequest.current = controller;
    const requestOwnerId = userId;
    const timeout = window.setTimeout(() => controller.abort(), 32000);
    try {
      const result = await sendPlantAssistantMessage({
        conversationId,
        context: selectedContext,
        message: text,
        image: photo ?? undefined,
        signal: controller.signal,
      });
      if (ownerIdRef.current !== requestOwnerId) return;
      setConversationId(result.conversationId);
      setMessages((current) => [...current, localMessage("user", text), result.message]);
      setMessage("");
      setPhoto(null);
      if (imageInput.current) imageInput.current.value = "";
      void loadPlantAssistantHistory().then((items) => {
        if (ownerIdRef.current === requestOwnerId) setHistory(items);
      }).catch((loadError: unknown) => {
        if (ownerIdRef.current === requestOwnerId) setHistoryError(loadError instanceof Error ? loadError.message : "Conversation history could not be refreshed.");
      });
    } catch (requestError) {
      if (ownerIdRef.current !== requestOwnerId) return;
      setFallback(!(requestError instanceof PlantAssistantError) || [
        "timeout", "network_error", "not_configured", "provider_timeout",
        "provider_unavailable", "invalid_output", "assistant_error",
      ].includes(requestError.code));
      setError(requestError instanceof PlantAssistantError
        ? requestError.message
        : requestError instanceof Error ? requestError.message : "The assistant request failed.");
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller) activeRequest.current = null;
      setBusy(false);
    }
  }

  function startNewConversation() {
    setConversationId(null);
    setMessages([]);
    setMessage("");
    setPhoto(null);
    setError("");
    setFallback(false);
  }

  async function openConversation(id: string) {
    const requestOwnerId = userId;
    if (!requestOwnerId) return;
    setHistoryBusy(true);
    setHistoryError("");
    try {
      const conversation = await loadPlantAssistantConversation(id);
      if (ownerIdRef.current !== requestOwnerId) return;
      setConversationId(conversation.id);
      setMessages(conversation.messages);
      setError("");
      setFallback(false);
    } catch (loadError) {
      if (ownerIdRef.current !== requestOwnerId) return;
      setHistoryError(loadError instanceof Error ? loadError.message : "This conversation could not be loaded.");
    } finally {
      if (ownerIdRef.current === requestOwnerId) setHistoryBusy(false);
    }
  }

  async function clearHistory() {
    if (!user || history.length === 0 || !window.confirm("Delete all saved plant assistant conversations? This cannot be undone.")) return;
    const requestOwnerId = userId;
    if (!requestOwnerId) return;
    setHistoryBusy(true);
    setHistoryError("");
    try {
      await clearPlantAssistantHistory();
      if (ownerIdRef.current !== requestOwnerId) return;
      setHistory([]);
      startNewConversation();
    } catch (clearError) {
      if (ownerIdRef.current !== requestOwnerId) return;
      setHistoryError(clearError instanceof Error ? clearError.message : "Conversation history could not be deleted.");
    } finally {
      if (ownerIdRef.current === requestOwnerId) setHistoryBusy(false);
    }
  }

  function choosePhoto(file: File | undefined) {
    setPhoto(file ?? null);
    setError("");
  }

  return <section className="assistant-page">
    <header className="page-heading">
      <div><p className="eyebrow">YOUR PLANT COMPANION</p><h1>Plant assistant</h1>
        <p className="page-description">Ask about your garden, a saved discovery, a species, or a plant-health concern.</p></div>
      <button className="button-secondary button-small" onClick={startNewConversation}><Plus size={15} /> New conversation</button>
    </header>
    <div className="assistant-layout">
      <aside className="assistant-history panel" aria-label="Conversation history">
        <div className="assistant-history-heading"><h2>History</h2><button className="button-quiet button-small" onClick={() => void clearHistory()} disabled={!user || history.length === 0 || historyBusy} aria-label="Clear all conversation history"><Trash2 size={15} /></button></div>
        {!user && <p className="assistant-history-empty">Sign in to save and revisit private conversation history.</p>}
        {historyBusy && <p className="assistant-history-empty" role="status">Loading history…</p>}
        {historyError && <p className="field-error" role="alert">{historyError}</p>}
        {user && !historyBusy && history.length === 0 && <p className="assistant-history-empty">Your saved conversations will appear here.</p>}
        {history.map((item) => <button key={item.id} className={`assistant-history-item ${conversationId === item.id ? "assistant-history-selected" : ""}`} onClick={() => void openConversation(item.id)}>
          <MessageCircle size={15} /><span><strong>{item.title}</strong><small>{new Date(item.updatedAt).toLocaleDateString()}</small></span>
        </button>)}
      </aside>
      <div className="assistant-chat panel">
        <div className="assistant-context">
          <label htmlFor="assistant-context">Ask in context</label>
          <select id="assistant-context" value={contextSelection} onChange={(event) => {
            if (event.target.value !== contextSelection && messages.length > 0) startNewConversation();
            setContextSelection(event.target.value);
          }}>
            <option value="general">General plant question</option>
            {plants.length > 0 && <optgroup label="My plants">{plants.map((plant) =>
              <option key={plant.id} value={`plant:${plant.id}`}>{plant.name} · {plant.scientificName || "species not recorded"}</option>
            )}</optgroup>}
            {discoveries.length > 0 && <optgroup label="Saved discoveries">{discoveries.map((discovery) =>
              <option key={discovery.id} value={`discovery:${discovery.id}`}>{discovery.commonName} · {discovery.scientificName}</option>
            )}</optgroup>}
            <option value="species">General species</option>
          </select>
          {contextSelection === "species" && <input aria-label="Species name" value={species} onChange={(event) => setSpecies(event.target.value)} maxLength={200} placeholder="e.g. Monstera deliciosa" />}
          <small>{selectedContext
            ? `Context: ${contextLabel(selectedContext, plants)}. Only the selected context is included.`
            : user ? "Enter a species name to continue." : "Local demo profiles are not sent to an AI service while signed out."}</small>
        </div>
        <div className="assistant-transcript" aria-live="polite">
          {messages.length === 0 && <div className="assistant-welcome">
            <div className="assistant-mark"><MessageCircle size={20} /></div>
            <h2>What would you like to know?</h2>
            <p>Choose an owned plant to include its authorized garden records. Saved discoveries and species questions do not include private plant history.</p>
            <div className="assistant-suggestions">{ASSISTANT_SUGGESTIONS.map((suggestion) =>
              <button key={suggestion} className="button-secondary button-small" onClick={() => setMessage(suggestion)}>{suggestion}</button>
            )}</div>
          </div>}
          {messages.map((item) => <article key={item.id} className={`assistant-message assistant-message-${item.role}`}>
            <span className="assistant-message-label">{item.role === "user" ? "You" : "Plant assistant"}</span>
            <p>{item.content}</p>
            {item.response && <div className="assistant-evidence">
              <p><strong>Uncertainty:</strong> {item.response.uncertainty}</p>
              {item.response.curatedFacts.length > 0 && <div><strong>Curated botanical facts</strong><ul>{item.response.curatedFacts.map((fact, index) => <li key={index}>{fact}</li>)}</ul></div>}
              <div><strong>User-reported data</strong>{item.response.userReportedData.length > 0
                ? <ul>{item.response.userReportedData.map((fact, index) => <li key={index}>{fact}</li>)}</ul>
                : <p>No relevant user-reported records were available for this reply.</p>}</div>
              {item.response.imageObservations.length > 0 && <div><strong>Image observations (not a diagnosis)</strong><ul>{item.response.imageObservations.map((observation, index) => <li key={index}>{observation}</li>)}</ul></div>}
              {item.response.aiInferences.length > 0 && <div><strong>Assistant inferences</strong><ul>{item.response.aiInferences.map((inference, index) => <li key={index}>{inference}</li>)}</ul></div>}
              {item.response.safetyNotice && <p className="assistant-safety"><strong>Safety:</strong> {item.response.safetyNotice}</p>}
            </div>}
          </article>)}
          {busy && <div className="assistant-loading" role="status"><LoaderCircle size={17} className="assistant-spinner" /> Checking the selected context…</div>}
          <div ref={messageEnd} />
        </div>
        {error && <div className="assistant-error" role="alert"><strong>{fallback ? "Assistant unavailable" : "Could not send message"}</strong><p>{fallback ? ASSISTANT_FALLBACK : error}</p><small>{error}</small>{fallback && <button className="button-secondary button-small" onClick={() => void submit()} disabled={busy}><RotateCcw size={14} /> Retry</button>}</div>}
        {!user && !authLoading && <div className="assistant-manual-note" role="note">Manual observation mode: messages stay in this page session only. They are not analyzed, saved, or sent to an AI service while signed out. Selected photos are not uploaded or analyzed.</div>}
        {photo && <div className="assistant-photo-chip"><ImagePlus size={15} /><span>{photo.name} · sent for visual understanding</span><button aria-label="Remove photo" onClick={() => choosePhoto(undefined)}><X size={15} /></button></div>}
        <form className="assistant-composer" onSubmit={(event) => void submit(event)}>
          <textarea aria-label="Your message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ask a question or describe what you notice…" maxLength={3000} rows={3} />
          <div className="assistant-composer-actions">
            <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Add an image for visual understanding" onChange={(event) => { choosePhoto(event.target.files?.[0]); event.target.value = ""; }} />
            <button type="button" className="button-secondary button-small" onClick={() => imageInput.current?.click()} disabled={busy}><ImagePlus size={15} /> Add photo</button>
            <span>{photo ? "Image understanding enabled for this request only." : "Text-only requests do not use image analysis."}</span>
            <button type="submit" className="button-primary button-small" disabled={busy || authLoading || !message.trim()}><Send size={14} /> Send</button>
          </div>
        </form>
      </div>
    </div>
  </section>;
}
