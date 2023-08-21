import { rooms, waitrooms } from "./rooms.ts";
import chooseWords from "./words.ts";
import { randomUUID } from "https://deno.land/std@0.134.0/node/crypto.ts";

export const initializeWaitRoom = (settings: Settings) => {
  return {
    id: randomUUID(),
    players: {},
    settings,
    round: 0,
    describerIndex: 0,
    ratings: [] as number[],
  };
};

export const getEndTime = (timeValue: number) => {
  let time = new Date();
  time.setSeconds(time.getSeconds() + timeValue);
  return time.getTime();
};

export const getRoomId = (socket: any) => {
  const roomId = [...socket.rooms].find((roomId) => roomId !== socket.id);
  if (!roomId) {
    throw new Error("Room not found");
  }
  return roomId as string;
};

export const getPlayer = (socket: any) => {
  const roomId = getRoomId(socket);
  const room = rooms[roomId];
  let player: Player | undefined;
  if (room) {
    player = Object.values(room.players).find(
      (player) => player.socketId === socket.id
    );
  } else {
    const waitroom = findWaitroomById(waitrooms, roomId);
    player = Object.values(waitroom.players).find(
      (player) => player.socketId === socket.id
    );
  }
  if (!player) {
    throw new Error("Player not found");
  }
  return player;
};

export const findWaitroomById = (waitrooms: Waitrooms, id: string) => {
  const waitroomArr = flattenWaitroom(waitrooms);
  const waitroom = waitroomArr.find((room) => room?.id === id);
  if (!waitroom) {
    throw new Error("Waitroom not found");
  }
  return waitroom;
};

const flattenWaitroom = (waitrooms: Waitrooms) => {
  return Object.values(waitrooms)
    .map((sub1) => Object.values(sub1).map((sub2) => Object.values(sub2)))
    .flat(3)
    .filter((room) => room);
};

export const getRemainingPlayers = (
  players: Record<string, Player>,
  disconnectingPlayer: Player
) => {
  return Object.fromEntries(
    Object.entries(players)
      .filter(([id]) => id !== disconnectingPlayer.id)
      .map(([id, player]) => [
        id,
        {
          ...player,
          order:
            player.order > disconnectingPlayer.order
              ? player.order - 1
              : player.order,
        },
      ])
  );
};

export const checkGameStart = (players: Record<string, Player>) => {
  const playerArr = Object.values(players);
  if (playerArr.length === 4) {
    return true;
  }
  return playerArr.every((p) => p.isReady);
};

export const initializePlayers = (
  players: Record<string, Player>,
  level: Settings["level"]
) => {
  const numberOfRounds = Object.keys(players).length > 2 ? 2 : 3;
  const words = chooseWords(
    Object.keys(players).length * numberOfRounds,
    level
  );
  words.push("");
  const newPlayers: Record<string, Player> = {};
  Object.entries(players).forEach(([id, player], i) => {
    const newPlayer = { ...player };
    newPlayer.score = 0;
    newPlayer.words = words.slice(
      i * numberOfRounds,
      i * numberOfRounds + numberOfRounds
    );
    newPlayers[id] = newPlayer;
  });
  return newPlayers;
};

export const updatePlayerNotes = (
  players: Record<string, Player>,
  playerId: string,
  notes: string[]
) => {
  const playerToUpdate = players[playerId];
  return { ...players, [playerId]: { ...playerToUpdate, notes } as Player };
};

const describerIsPresent = (players: Record<string, Player>, desc: number) => {
  const playerArr = Object.values(players);
  return playerArr.some((p) => p.order === desc);
};

export const getNextTurn = ({ players, describerIndex, round }: Room) => {
  let nextDesc = describerIndex;
  let nextRound = round;
  do {
    if (nextDesc === 3) {
      nextRound++;
      nextDesc = 0;
    } else {
      nextDesc++;
    }
  } while (!describerIsPresent(players, nextDesc));
  return { nextDesc, nextRound };
};

const decodeUserInput = (input: string) => {
  const inputWithout3 = input.replace(/3/g, "e");
  const inputWithout0 = inputWithout3.replace(/0/g, "o");
  const inputWithout1 = inputWithout0.replace(/1/g, "i");
  return inputWithout1;
};

export const checkUserInput = (
  input: string,
  targetWord: string,
  isDescriber = false
) => {
  const regex = new RegExp(`\\b${targetWord}\\b`, "ig");
  if (!isDescriber) return regex.test(input);
  const decodedInput = decodeUserInput(input);
  if (regex.test(decodedInput)) return true;
  return decodedInput.includes(targetWord.split("").join(" "));
};

export const updateTurn = (room: Room) => {
  const { nextDesc, nextRound } = getNextTurn(room);
  const previousRound = room.round;
  rooms[room.id].round = nextRound;
  rooms[room.id].describerIndex = nextDesc;
  return { ...rooms[room.id], roundChanged: previousRound !== nextRound };
};

export const createBotMessage = (message: string) => {
  return {
    sender: null,
    isBot: true,
    isDescriber: null,
    text: message,
  };
};

export const increasePlayerScore = (
  players: Record<string, Player>,
  playerId: string,
  earnedScore: number
) => {
  const scoringPlayer = players[playerId];
  return {
    ...players,
    [playerId]: { ...scoringPlayer, score: scoringPlayer.score + earnedScore },
  };
};

export const startGame = (waitroom: Room) => {
  const newPlayers = initializePlayers(
    waitroom.players,
    waitroom.settings.level
  );
  rooms[waitroom.id] = { ...waitroom, players: newPlayers };
  return newPlayers;
};

export const calculateGameStats = (players: Record<string, Player>) => {
  const playerArray = Object.values(players);
  const playersWithRank: Record<string, Player & { rank?: number }> = {
    ...players,
  };
  playerArray.forEach((player) => {
    const rank = playerArray.reduce((rank, p) => {
      if (player.score < p.score) return rank + 1;
      return rank;
    }, 1);
    playersWithRank[player.id].rank = rank;
  });
  const rankSum = Object.values(playersWithRank).reduce((total, player) => {
    return total + player.rank!;
  }, 0);
  playerArray.forEach((player) => {
    playersWithRank[player.id].win =
      playersWithRank[player.id].rank! <= rankSum / playerArray.length ? 1 : 0;
  });
  return playersWithRank;
};
