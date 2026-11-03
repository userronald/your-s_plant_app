import { useEffect, useRef, useState } from "react";
import { Camera, Plus, Trash2, Upload } from "lucide-react";
import type { IdentificationPhoto, PlantOrgan } from "../domain/identification";
import { prepareIdentificationPhoto } from "../data/plantPhotoCompression";

const organs: Array<{ value: PlantOrgan; label: string }> = [
  { value: "leaf", label: "Leaf" },
  { value: "flower", label: "Flower" },
  { value: "fruit", label: "Fruit" },
  { value: "habit", label: "Whole plant" },
  { value: "bark", label: "Bark" },
  { value: "other", label: "Other" },
];

interface PhotoEntry extends IdentificationPhoto {
  id: string;
  preview: string;
}

export function PlantIdentificationUploader({ onChange, disabled = false }: {
  onChange: (photos: IdentificationPhoto[]) => void;
  disabled?: boolean;
}) {
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef(photos);
  photosRef.current = photos;

  useEffect(() => () => {
    photosRef.current.forEach(({ preview }) => URL.revokeObjectURL(preview));
  }, []);

  async function acceptFiles(files: FileList | null) {
    if (!files?.length) return;
    const remaining = 5 - photos.length;
    if (remaining <= 0) {
      setError("You can add up to five photos of the same plant.");
      return;
    }
    const selected = Array.from(files).slice(0, remaining);
    if (files.length > remaining) setError("Only the first five photos were added.");
    else setError("");
    setPreparing(true);
    const additions: PhotoEntry[] = [];
    try {
      for (const file of selected) {
        const prepared = await prepareIdentificationPhoto(file);
        additions.push({
          id: crypto.randomUUID(),
          file: prepared,
          organ: "leaf",
          preview: URL.createObjectURL(prepared),
        });
      }
      const next = [...photos, ...additions];
      setPhotos(next);
      onChange(next.map(({ file, organ }) => ({ file, organ })));
    } catch (photoError) {
      additions.forEach(({ preview }) => URL.revokeObjectURL(preview));
      setError(photoError instanceof Error ? photoError.message : "The selected photo could not be prepared.");
    } finally {
      setPreparing(false);
      if (galleryRef.current) galleryRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  }

  function changeOrgan(id: string, organ: PlantOrgan) {
    const next = photos.map((photo) => photo.id === id ? { ...photo, organ } : photo);
    setPhotos(next);
    onChange(next.map(({ file, organ: photoOrgan }) => ({ file, organ: photoOrgan })));
  }

  function removePhoto(id: string) {
    const removed = photos.find((photo) => photo.id === id);
    if (removed) URL.revokeObjectURL(removed.preview);
    const next = photos.filter((photo) => photo.id !== id);
    setPhotos(next);
    onChange(next.map(({ file, organ }) => ({ file, organ })));
    setError("");
  }

  return <div className="identification-uploader">
    <input ref={galleryRef} className="sr-only" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" multiple onChange={(event) => void acceptFiles(event.target.files)} aria-label="Choose plant photos from gallery" />
    <input ref={cameraRef} className="sr-only" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" capture="environment" onChange={(event) => void acceptFiles(event.target.files)} aria-label="Take a plant photo" />
    {photos.length > 0 && <div className="identification-photo-grid">{photos.map((photo) => <article className="identification-photo" key={photo.id}>
      <img src={photo.preview} alt={`Plant photo ${photos.indexOf(photo) + 1}`} />
      <label>Photo {photos.indexOf(photo) + 1} shows
        <select value={photo.organ} onChange={(event) => changeOrgan(photo.id, event.target.value as PlantOrgan)} disabled={disabled || preparing}>
          {organs.map((organ) => <option value={organ.value} key={organ.value}>{organ.label}</option>)}
        </select>
      </label>
      <button type="button" className="button-quiet button-small" aria-label={`Remove photo ${photos.indexOf(photo) + 1}`} onClick={() => removePhoto(photo.id)} disabled={disabled || preparing}><Trash2 size={14} /> Remove</button>
    </article>)}</div>}
    <div className="identification-upload-actions">
      <button type="button" className="button-secondary" onClick={() => galleryRef.current?.click()} disabled={disabled || preparing || photos.length >= 5}><Upload size={15} /> Choose from gallery</button>
      <button type="button" className="button-secondary" onClick={() => cameraRef.current?.click()} disabled={disabled || preparing || photos.length >= 5}><Camera size={15} /> Take a photo</button>
      {photos.length > 0 && photos.length < 5 && <span className="subtle">{photos.length} of 5 photos</span>}
      {preparing && <span className="subtle" role="status">Preparing photos…</span>}
    </div>
    {photos.length < 5 && <button type="button" className="button-quiet button-small identification-add-photo" onClick={() => galleryRef.current?.click()} disabled={disabled || preparing}><Plus size={14} /> Add another view of this plant</button>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <p className="subtle identification-upload-note">JPEG or PNG · up to 20 MB before compression · photos are sent only when you choose Identify</p>
  </div>;
}
