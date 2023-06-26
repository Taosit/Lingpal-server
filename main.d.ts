type Settings = {
  mode: "standard" | "relaxed";
  level: "easy" | "hard";
  describer: "voice" | "text";
};

type Player = {
  id: string;
  username: string;
  avatar: string;
  total: number;
  win: number;
  advanced: number;
  isReady: boolean;
  order: number;
  score: number;
  words: null | string[];
  notes: null | string[];
  socketId: string;
};

type Room = {
  id: string;
  players: Record<string, Player>;
  settings: Settings;
  timer?: number;
  round: number;
  describerIndex: number;
  ratings: number[];
};

type Waitrooms = {
  [mode in Settings["mode"]]: {
    [level in Settings["level"]]: {
      [describer in Settings["describer"]]: Room | null;
    };
  };
};

type SocketEvent = {
  "join-room": {
    settings: Settings;
    player: Player;
  };
};
