import { serve } from "https://deno.land/std@0.150.0/http/server.ts";
import { Server } from "https://deno.land/x/socket_io@0.2.0/mod.ts";

import { waitrooms, rooms } from "./utils/rooms.ts";

import {
  increasePlayerScore,
  updatePlayerNotes,
  checkGameStart,
  startGame,
  calculateGameStats,
  findWaitroomById,
  getRoomId,
  getEndTime,
  getPlayer,
  initializeWaitRoom,
  updateTurn,
} from "./utils/helpers.ts";

const developmentUrl = "http://localhost:3000";
const productionUrl = "https://lingpal.vercel.app";

const io = new Server({
  cors: {
    origin: [developmentUrl, productionUrl],
  },
});

io.on("connection", (socket) => {
  console.log("connected");
  socket.on(
    "join-room",
    ({ settings, player }: SocketEvent["join-room"], callback) => {
      const { mode, level, describer } = settings;
      let waitroom = waitrooms[mode][level][describer];
      if (!waitroom) {
        waitroom = initializeWaitRoom(settings);
        waitrooms[mode][level][describer] = waitroom;
      }
      const userCopy: Player = {
        ...player,
        order: Object.keys(waitroom.players).length,
        isReady: false,
        socketId: socket.id,
      };
      waitroom.players[player.id] = userCopy;
      socket.join(waitroom.id);
      io.to(waitroom.id).emit("update-players", waitroom.players);
      if (Object.keys(waitroom.players).length === 4) {
        const newPlayers = startGame(waitroom);
        io.to(waitroom.id).emit("start-game", newPlayers);
        waitrooms[mode][level][describer] = null;
      }
      callback(waitroom.id);
    }
  );

  socket.on("player-ready", () => {
    const roomId = getRoomId(socket);
    const playerId = getPlayer(socket).id;
    const waitroom = findWaitroomById(waitrooms, roomId);
    waitroom.players[playerId].isReady = !waitroom.players[playerId].isReady;
    io.to(waitroom.id).emit("update-players", waitroom.players);
    if (checkGameStart(waitroom.players)) {
      const newPlayers = startGame(waitroom);
      io.to(waitroom.id).emit("start-game", newPlayers);
      const { mode, level, describer } = waitroom.settings;
      waitrooms[mode][level][describer] = null;
    }
  });

  socket.on("set-timer", (time: number) => {
    const roomId = getRoomId(socket);
    clearInterval(rooms[roomId].timer);
    const endTime = getEndTime(time);
    io.to(roomId).emit("update-time", time);
    const interval = setInterval(() => {
      const updatedTime = Math.round((endTime - new Date().getTime()) / 1000);
      io.to(roomId).emit("update-time", updatedTime);
      if (updatedTime <= 0) {
        clearInterval(interval);
      }
    }, 1000);
    rooms[roomId].timer = interval;
  });

  socket.on("save-notes", (notes: string[]) => {
    const roomId = getRoomId(socket);
    const playerId = getPlayer(socket).id;
    const players = rooms[roomId].players;
    const updatedPlayers = updatePlayerNotes(players, playerId, notes);
    rooms[roomId].players = updatedPlayers;
    io.to(roomId).emit("update-players", updatedPlayers);
  });

  socket.on("update-turn", () => {
    const roomId = getRoomId(socket);
    const { round, describerIndex, players } = updateTurn(rooms[roomId]);

    if (round < 2) {
      io.to(roomId).emit("turn-updated", {
        nextRound: round,
        nextDesc: describerIndex,
        players,
      });
    } else {
      const playersWithStats = calculateGameStats(rooms[roomId].players);
      io.to(roomId).emit("game-over", playersWithStats);
    }
  });

  socket.on("send-message", ({ message, targetWord }) => {
    const roomId = getRoomId(socket);
    const { sender, isDescriber, text } = message;
    const includesWord = text.toLowerCase().includes(targetWord);
    if (includesWord && isDescriber) return;
    io.to(roomId).emit("receive-message", message);
    if (includesWord) {
      const confirmMessage = {
        sender: null,
        isBot: true,
        isDescriber: null,
      };
      socket.broadcast.to(roomId).emit("receive-message", {
        ...confirmMessage,
        text: `The correct word is ${targetWord}. ${sender.username} got 2 points`,
      });
      socket.emit("receive-message", {
        ...confirmMessage,
        text: `The correct word is ${targetWord}. Well done!`,
      });
      clearInterval(rooms[roomId].timer);
      const players = rooms[roomId].players;
      let updatedPlayers = increasePlayerScore(players, sender.id, 2);
      const describer = Object.values(players).find(
        (p) => p.order === rooms[roomId].describerIndex
      );
      if (!describer) {
        throw new Error("Describer not found");
      }
      updatedPlayers = increasePlayerScore(updatedPlayers, describer.id, 1);
      rooms[roomId].players = updatedPlayers;
      io.to(roomId).emit("correct-answer", updatedPlayers);
    }
  });

  socket.on("send-rating", (rating) => {
    const roomId = getRoomId(socket);
    rooms[roomId].ratings.push(rating);
    const averageRating =
      rooms[roomId].ratings.reduce((total, rating) => total + rating) /
      rooms[roomId].ratings.length;
    io.to(roomId).emit("rating-update", averageRating);
  });

  socket.on("clear-ratings", () => {
    const roomId = getRoomId(socket);
    rooms[roomId].ratings = [];
  });

  socket.on("disconnecting", async () => {
    console.log("disconnecting");
    const roomId = getRoomId(socket);
    if (!roomId) return;
    if (rooms[roomId]) {
      const disconnectingPlayer = Object.values(rooms[roomId].players).find(
        (p) => p.socketId === socket.id
      );
      if (!disconnectingPlayer) return;
      // await User.findByIdAndUpdate(disconnectingPlayer.id, {
      //   $inc: { total: 1 },
      // });
      delete rooms[roomId].players[disconnectingPlayer.id];
      if (Object.keys(rooms[roomId].players).length === 0) {
        delete rooms[roomId];
        return;
      }
      if (disconnectingPlayer.order === rooms[roomId].describerIndex) {
        const { round, describerIndex, players } = updateTurn(rooms[roomId]);
        socket.broadcast.to(roomId).emit("player-left", {
          disconnectingPlayer,
          nextDesc: describerIndex,
          nextRound: round,
          remainingPlayers: players,
        });
      } else {
        socket.broadcast.to(roomId).emit("player-left", {
          disconnectingPlayer,
          remainingPlayers: rooms[roomId].players,
        });
      }
    } else {
      const waitroom = findWaitroomById(waitrooms, roomId);
      const disconnectingUser = Object.values(waitroom.players).find(
        (p) => p.socketId === socket.id
      );
      if (!disconnectingUser) return;
      delete waitroom.players[disconnectingUser.id];
      const { mode, level, describer } = waitroom.settings;
      if (Object.keys(waitroom.players).length > 0) {
        waitrooms[mode][level][describer]!.players = waitroom.players;
        socket.broadcast.to(roomId).emit("update-players", waitroom.players);
      } else {
        waitrooms[mode][level][describer] = null;
      }
    }
  });

  socket.on("disconnect", () => {});
});

const PORT = Deno.env.get("PORT") ? parseInt(Deno.env.get("PORT")!) : 5050;

await serve(io.handler(), {
  port: PORT,
});
