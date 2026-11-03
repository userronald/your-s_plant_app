import type { AppData } from "../domain/types";

export const DEMO_STORAGE_KEY = "plant-ai-companion-demo-v1";

export const initialDemoData: AppData = {
  plants: [
    {
      id: "demo-monstera",
      name: "Monstera",
      scientificName: "Monstera deliciosa",
      imageUrl: "https://images.unsplash.com/photo-1614594975525-e45190c55d0b?auto=format&fit=crop&w=900&q=85",
      location: "Living room",
      health: "good",
      lastWatered: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      wateringIntervalDays: 10,
      light: "Bright, indirect light",
      events: [
        { id: "demo-event-water", type: "water", date: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), note: "Watered after checking the top layer of soil." },
        { id: "demo-event-observe", type: "observation", date: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString(), note: "A new leaf is beginning to unfurl." },
      ],
    },
    {
      id: "demo-pothos",
      name: "Golden pothos",
      scientificName: "Epipremnum aureum",
      imageUrl: "https://images.unsplash.com/photo-1614594895304-fe7116ac3b58?auto=format&fit=crop&w=900&q=85",
      location: "Kitchen shelf",
      health: "good",
      lastWatered: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      wateringIntervalDays: 9,
      light: "Medium, indirect light",
      events: [],
    },
    {
      id: "demo-rubber",
      name: "Rubber plant",
      scientificName: "Ficus elastica",
      imageUrl: "https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=900&q=85",
      location: "Bedroom",
      health: "good",
      lastWatered: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
      wateringIntervalDays: 12,
      light: "Bright, filtered light",
      events: [],
    },
  ],
  discoveries: [],
};
