const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// ── Statements ────────────────────────────────────────────────────
const statements = [
  { id: 1, unit: "Machines & the Moral Circle", text: "If an AI system behaves exactly like a conscious being in every observable way, we should treat it as though it is conscious \u2014 even if we can never verify what\u2019s happening inside." },
  { id: 2, unit: "Machines & the Moral Circle", text: "There is nothing morally wrong with programming a robot to beg for its life when threatened with being shut down, assuming the robot is not actually conscious and is a mere simulacrum." },
  { id: 3, unit: "AI Companionship", text: "An AI system that remembers your birthday, asks about your sick mother, and checks in on you daily is performing genuine acts of care \u2014 even if it has no inner experience." },
  { id: 4, unit: "AI Sycophancy", text: "An AI that consistently challenges and pushes back on everything you say is more dangerous than one that always agrees with you." },
  { id: 5, unit: "Privacy", text: "The intimate personal data that AI companions collect about users is a fair trade-off for the emotional support they provide." },
  { id: 6, unit: "Care Bots", text: "Replacing a human caregiver with a care robot for an elderly person is morally acceptable if the robot measurably improves their quality of life." },
  { id: 7, unit: "Authenticity & AI", text: "A father who has never been able to express his emotions uses AI to generate heartfelt, vulnerable text messages to his estranged daughter \u2014 messages that accurately reflect feelings he truly has but cannot articulate on his own. There is nothing morally wrong with this." },
  { id: 8, unit: "Online Dating", text: "A dating app that uses your personal data to secretly filter out matches the algorithm predicts you\u2019ll reject \u2014 without telling you it\u2019s doing so \u2014 is doing you a favor." },
  { id: 9, unit: "Sex Bots", text: "There is nothing morally wrong with owning and using a sex robot in private, as long as no real person is directly harmed by it." },
  { id: 10, unit: "Sex Work & Harm Reduction", text: "If we accept that casual sex between consenting adults is morally permissible, then we should also accept that sex work between consenting adults is morally permissible." },
  { id: 11, unit: "Robot Legality", text: "Society should pass laws that protect a person\u2019s deep emotional relationship with their robot, similar to how we protect relationships with religious objects or monuments." },
  { id: 12, unit: "Virtual Worlds", text: "Committing virtual murder in a video game is morally equivalent to committing virtual sexual violence in the same game \u2014 either both are acceptable or neither is." },
  { id: 13, unit: "Deepfakes", text: "Creating a deepfake pornographic image of someone is morally wrong even if you never show it to anyone, keep it entirely private, and immediately destroy it after consumption." },
  { id: 14, unit: "Digital Duplicates", text: "It is morally acceptable to continue interacting with an AI replica of your ex-partner after a breakup \u2014 as long as your ex-partner has given you explicit permission to do so." },
];

// ── Room Management ───────────────────────────────────────────────
const rooms = {};

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ── Socket.io ─────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // Host creates a room
  socket.on("host-create", (callback) => {
    let code = generateCode();
    while (rooms[code]) code = generateCode();

    rooms[code] = {
      hostId: socket.id,
      activeStatement: null,
      participants: {},    // socketId -> { name, votes: { statementId: value } }
      revealed: {},        // statementId -> true/false
      locked: {},          // statementId -> true/false (voting closed)
    };

    socket.join(code);
    callback({ code, statements });
    console.log(`Room ${code} created by ${socket.id}`);
  });

  // Student joins a room
  socket.on("student-join", ({ code, name }, callback) => {
    const room = rooms[code];
    if (!room) return callback({ error: "Room not found. Check your code and try again." });

    room.participants[socket.id] = { name, votes: {} };
    socket.join(code);

    // Notify host of new participant
    io.to(room.hostId).emit("participant-joined", {
      id: socket.id,
      name,
      count: Object.keys(room.participants).length,
    });

    // Send current state to student
    callback({
      success: true,
      statements,
      activeStatement: room.activeStatement,
      revealed: room.revealed,
      locked: room.locked,
    });

    console.log(`${name} joined room ${code}`);
  });

  // Host selects a statement to display
  socket.on("host-select-statement", ({ code, statementId }) => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;

    room.activeStatement = statementId;

    // Send to all students
    io.to(code).emit("statement-activated", { statementId });
  });

  // Student submits a vote
  socket.on("student-vote", ({ code, statementId, value }) => {
    const room = rooms[code];
    if (!room || !room.participants[socket.id]) return;
    if (room.locked[statementId]) return; // voting closed

    room.participants[socket.id].votes[statementId] = value;

    // Notify host of vote count (not the actual vote)
    const totalParticipants = Object.keys(room.participants).length;
    const votedCount = Object.values(room.participants).filter(
      (p) => p.votes[statementId] !== undefined
    ).length;

    io.to(room.hostId).emit("vote-update", {
      statementId,
      votedCount,
      totalParticipants,
    });
  });

  // Host reveals results for a statement
  socket.on("host-reveal", ({ code, statementId }) => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;

    room.revealed[statementId] = true;
    room.locked[statementId] = true;

    // Tally votes
    const tally = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const totalVoters = Object.keys(room.participants).length;
    Object.values(room.participants).forEach((p) => {
      const v = p.votes[statementId];
      if (v) tally[v]++;
    });

    io.to(code).emit("results-revealed", { statementId, tally, totalVoters });
  });

  // Host locks voting (without revealing)
  socket.on("host-lock", ({ code, statementId }) => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;

    room.locked[statementId] = true;
    io.to(code).emit("voting-locked", { statementId });
  });

  // Host resets a statement's votes
  socket.on("host-reset-statement", ({ code, statementId }) => {
    const room = rooms[code];
    if (!room || room.hostId !== socket.id) return;

    Object.values(room.participants).forEach((p) => {
      delete p.votes[statementId];
    });
    room.revealed[statementId] = false;
    room.locked[statementId] = false;

    io.to(code).emit("statement-reset", { statementId });
  });

  // Disconnect handling
  socket.on("disconnect", () => {
    for (const [code, room] of Object.entries(rooms)) {
      if (room.hostId === socket.id) {
        io.to(code).emit("session-ended");
        delete rooms[code];
        console.log(`Room ${code} closed (host disconnected)`);
      } else if (room.participants[socket.id]) {
        const name = room.participants[socket.id].name;
        delete room.participants[socket.id];
        io.to(room.hostId).emit("participant-left", {
          id: socket.id,
          name,
          count: Object.keys(room.participants).length,
        });
        console.log(`${name} left room ${code}`);
      }
    }
  });
});

// ── Start ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
