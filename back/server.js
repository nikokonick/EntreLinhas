/* ================= SERVER.JS ================= */

const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const SECRET = "entrelinhas_secret";

/* ================= MONGODB ================= */

// Substitua pela sua URI do MongoDB Atlas
const MONGO_URI = "mongodb+srv://nikoko:senhaforte2430@entrelinhas.tzpt5a7.mongodb.net/entrelinhas?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log("MongoDB conectado ✅"))
  .catch(err => console.log("Erro MongoDB:", err));

/* ================= SCHEMAS ================= */

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  username: { type: String, unique: true },
  password: String,
  grade: String,
  region: String
});

const postSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  username: String,
  content: String,
  anonymous: Boolean,
  hideLikes: Boolean,
  mood: String,
  likes: [mongoose.Schema.Types.ObjectId],
  reports: [mongoose.Schema.Types.ObjectId],
  comments: [{
    userId: mongoose.Schema.Types.ObjectId,
    username: String,
    content: String,
    createdAt: { type: Date, default: Date.now }
  }],
  hidden: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);
const Post = mongoose.model("Post", postSchema);

/* ================= AUTH MIDDLEWARE ================= */

async function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Token necessário" });

  // Suporta "Bearer <token>"
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;

  try {
    const decoded = jwt.verify(token, SECRET);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ error: "Usuário não encontrado" });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Token inválido" });
  }
}

/* ================= REGISTER ================= */

app.post("/auth/register", async (req, res) => {
  const { email, username, password, grade, region } = req.body;

  if (!email || !username || !password || !grade || !region)
    return res.status(400).json({ error: "Preencha todos os campos" });

  try {
    const user = new User({ email, username, password, grade, region });
    await user.save();
    res.json({ message: "Conta criada" });
  } catch (err) {
    if (err.code === 11000) {
      res.status(400).json({ error: "Email ou username já cadastrado" });
    } else {
      res.status(500).json({ error: "Erro no servidor" });
    }
  }
});

/* ================= LOGIN ================= */

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email, password });
  if (!user) return res.status(400).json({ error: "Credenciais inválidas" });

  const token = jwt.sign({ id: user._id, username: user.username }, SECRET);
  res.json({ token });
});

/* ================= CREATE POST ================= */

app.post("/posts", auth, async (req, res) => {
  const { content, anonymous, hideLikes, mood } = req.body;

  if (!content || content.length > 500)
    return res.status(400).json({ error: "Conteúdo inválido (máx 500 caracteres)" });

  if (/(http|www|\.com|\.net|\.org)/i.test(content))
    return res.status(400).json({ error: "Links não permitidos" });

  const alreadyPostedToday = await Post.findOne({
    userId: req.user._id,
    createdAt: { $gte: new Date(new Date().setHours(0,0,0,0)) }
  });

  if (alreadyPostedToday)
    return res.status(400).json({ error: "Você já postou hoje" });

  const post = new Post({
    userId: req.user._id,
    username: req.user.username,
    content,
    anonymous,
    hideLikes,
    mood
  });

  await post.save();
  res.json(post);
});

/* ================= GET POSTS ================= */

app.get("/posts", async (req, res) => {
  const posts = await Post.find({ hidden: false }).sort({ createdAt: -1 });
  res.json(posts);
});

/* ================= LIKE ================= */

app.post("/posts/:id/like", auth, async (req, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) return res.status(404).json({ error: "Post não encontrado" });

  const liked = post.likes.some(id => id.equals(req.user._id));
  if (liked) post.likes = post.likes.filter(id => !id.equals(req.user._id));
  else post.likes.push(req.user._id);

  await post.save();
  res.json({ likes: post.likes.length });
});

/* ================= COMMENT ================= */

app.post("/posts/:id/comment", auth, async (req, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) return res.status(404).json({ error: "Post não encontrado" });

  const { content } = req.body;
  if (!content || content.length > 250)
    return res.status(400).json({ error: "Comentário inválido (máx 250 caracteres)" });

  if (/(http|www|\.com|\.net|\.org)/i.test(content))
    return res.status(400).json({ error: "Links não permitidos" });

  post.comments.push({
    userId: req.user._id,
    username: req.user.username,
    content
  });

  await post.save();
  res.json({ message: "Comentário adicionado" });
});

/* ================= DELETE POST ================= */

app.delete("/posts/:id", auth, async (req, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) return res.status(404).json({ error: "Post não encontrado" });

  if (!post.userId.equals(req.user._id))
    return res.status(403).json({ error: "Sem permissão" });

  await Post.deleteOne({ _id: post._id });
  res.json({ message: "Post apagado" });
});

/* ================= DELETE COMMENT ================= */

app.delete("/posts/:postId/comment/:commentId", auth, async (req, res) => {
  const post = await Post.findById(req.params.postId);
  if (!post) return res.status(404).json({ error: "Post não encontrado" });

  const comment = post.comments.id(req.params.commentId);
  if (!comment) return res.status(404).json({ error: "Comentário não encontrado" });

  if (!comment.userId.equals(req.user._id))
    return res.status(403).json({ error: "Sem permissão" });

  comment.remove();
  await post.save();
  res.json({ message: "Comentário apagado" });
});

/* ================= REPORT ================= */

app.post("/posts/:id/report", auth, async (req, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) return res.status(404).json({ error: "Post não encontrado" });

  if (post.reports.includes(req.user._id))
    return res.status(400).json({ error: "Você já denunciou" });

  post.reports.push(req.user._id);

  if (post.reports.length >= 10) post.hidden = true;

  await post.save();
  res.json({ reports: post.reports.length });
});

/* ================= HISTORY ================= */

app.get("/me/history", auth, async (req, res) => {
  const myPosts = await Post.find({ userId: req.user._id });
  const myComments = [];

  const allPosts = await Post.find();
  allPosts.forEach(p => {
    p.comments.forEach(c => {
      if (c.userId.equals(req.user._id)) {
        myComments.push({ postId: p._id, ...c.toObject() });
      }
    });
  });

  res.json({ posts: myPosts, comments: myComments });
});

/* ================= SERVIR FRONT ================= */

app.use(express.static(path.join(__dirname, "public")));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ================= SERVER ================= */

app.listen(3000, () => console.log("Servidor rodando na porta 3000 🚀"));
