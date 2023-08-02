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
  createBotMessage,
  getRemainingPlayers,
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

  socket.on("start-round", () => {
    const room = rooms[getRoomId(socket)];
    const player = getPlayer(socket);
    const describer = Object.values(room.players).find(
      (p) => p.order === room.describerIndex
    );
    if (!describer) {
      throw new Error("Describer not found");
    }
    if (player.id !== describer.id) {
      const message = createBotMessage(
        `${describer.username} is describing. Please wait`
      );
      socket.emit("receive-message", message);
    } else {
      const message = createBotMessage("You are describing");
      socket.emit("receive-message", message);
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
    const { round, describerIndex, players, roundChanged } = updateTurn(
      rooms[roomId]
    );

    if (round < 2) {
      io.to(roomId).emit("turn-updated", {
        nextRound: round,
        nextDesc: describerIndex,
        players,
      });
      if (roundChanged) return;
      const newDescriber = Object.values(players).find(
        (p) => p.order === describerIndex
      );
      if (!newDescriber) {
        throw new Error("Describer not found");
      }
      const describerName = newDescriber?.username.replace(
        newDescriber?.username[0],
        newDescriber?.username[0].toUpperCase()
      );
      Object.values(players).forEach((player) => {
        const label =
          player.id === newDescriber.id ? "You are" : `${describerName} is`;
        const message = createBotMessage(`${label} describing`);
        io.to(player.socketId).emit("receive-message", message);
      });
    } else {
      const playersWithStats = calculateGameStats(rooms[roomId].players);
      Object.values(playersWithStats).forEach((player) => {
        const message = createBotMessage(
          `Game is over, your rank is ${player.rank}`
        );
        io.to(player.socketId).emit("receive-message", message);
      });
      io.to(roomId).emit("game-over", playersWithStats);
    }
  });

  socket.on("send-message", ({ message, targetWord }) => {
    const roomId = getRoomId(socket);
    const { sender, isDescriber, text } = message;
    const includesWord = text.toLowerCase().includes(targetWord);
    if (includesWord && isDescriber) {
      const message = createBotMessage(
        "This message cannot be sent. You cannot include the word in your message"
      );
      socket.emit("receive-message", message);
      return;
    }
    io.to(roomId).emit("receive-message", message);
    if (includesWord) {
      const confirmMessageSender = createBotMessage(
        `The correct word is ${targetWord}. Well done!`
      );
      socket.emit("receive-message", confirmMessageSender);
      const confirmMessageNonSender = createBotMessage(
        `The correct word is ${targetWord}. ${sender.username} got 2 points`
      );
      socket.broadcast
        .to(roomId)
        .emit("receive-message", confirmMessageNonSender);
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

  socket.on("voice-stream", ({ receiverId, signal }) => {
    const roomId = getRoomId(socket);
    const senderSocketId = socket.id;
    const receiverSocketId = Object.values(rooms[roomId].players).find(
      (p) => p.id === receiverId
    )?.socketId;
    if (!receiverSocketId) {
      throw new Error("Receiver not found");
    }
    socket
      .to(receiverSocketId)
      .emit("receive-voice-stream", { senderSocketId, signal });
  });

  socket.on("return-signal", ({ senderSocketId, signal }) => {
    const receiverId = getPlayer(socket).id;
    if (!receiverId) {
      throw new Error("Receiver not found");
    }
    socket.to(senderSocketId).emit("receive-return-signal", {
      receiverId,
      signal,
    });
  });

  socket.on("time-out", (word: string) => {
    const roomId = getRoomId(socket);
    const describerMessage = createBotMessage(
      "Time is up. No one got the correct word"
    );
    socket.emit("receive-message", describerMessage);
    const nonDescriberMessage = createBotMessage(
      `Time is up. The correct word is ${word}`
    );
    socket.broadcast.to(roomId).emit("receive-message", nonDescriberMessage);
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
      const remainingPlayerNumber = Object.keys(rooms[roomId].players).length;
      if (remainingPlayerNumber === 0) {
        delete rooms[roomId];
        return;
      }
      if (remainingPlayerNumber === 1) {
        const message = createBotMessage(
          `Player ${disconnectingPlayer.username} left the game. The game is over`
        );
        socket.broadcast.to(roomId).emit("receive-message", message);
        const playersWithStats = calculateGameStats(rooms[roomId].players);
        io.to(roomId).emit("game-over", playersWithStats);
        delete rooms[roomId];
        return;
      }
      const leftGameMessage = createBotMessage(
        `Player ${disconnectingPlayer.username} left the game`
      );
      socket.broadcast.to(roomId).emit("receive-message", leftGameMessage);
      if (disconnectingPlayer.order === rooms[roomId].describerIndex) {
        const { round, describerIndex, players } = updateTurn(rooms[roomId]);
        socket.broadcast.to(roomId).emit("player-left", {
          disconnectingPlayer,
          nextDesc: describerIndex,
          nextRound: round,
          remainingPlayers: players,
        });
        const newDescriber = Object.values(players).find(
          (p) => p.order === describerIndex
        );
        Object.values(players).forEach((player) => {
          const username = newDescriber?.username.replace(
            newDescriber?.username[0],
            newDescriber?.username[0].toUpperCase()
          );
          const label =
            player.socketId === socket.id ? "You are" : `${username} is`;
          const describerMessage = createBotMessage(`${label} describing`);
          io.to(player.socketId).emit("receive-message", describerMessage);
        });
      } else {
        socket.broadcast.to(roomId).emit("player-left", {
          disconnectingPlayer,
          remainingPlayers: rooms[roomId].players,
        });
      }
    } else {
      try {
        const waitroom = findWaitroomById(waitrooms, roomId);
        const disconnectingUser = Object.values(waitroom.players).find(
          (p) => p.socketId === socket.id
        );
        if (!disconnectingUser) return;
        const remainingPlayers = getRemainingPlayers(
          waitroom.players,
          disconnectingUser
        );
        const { mode, level, describer } = waitroom.settings;
        if (Object.keys(remainingPlayers).length === 0) {
          waitrooms[mode][level][describer] = null;
          return;
        }
        waitrooms[mode][level][describer]!.players = remainingPlayers;
        socket.broadcast.to(roomId).emit("update-players", remainingPlayers);
      } catch (error) {
        console.log("Already left the room");
      }
    }
  });
});

const PORT = Deno.env.get("PORT") ? parseInt(Deno.env.get("PORT")!) : 5050;

await serve(io.handler(), {
  port: PORT,
});
