import mongoose from "mongoose";
import jwt from "jsonwebtoken";

// ================= CONFIGURAÇÃO =================
const SECRET = "entrelinhas_secret";
const MONGO_URI = "mongodb+srv://nikoko:senhaforte2430@entrelinhas.tzpt5a7.mongodb.net/entrelinhas?retryWrites=true&w=majority";

let conn = null;
async function connectDB() {
  if (conn) return conn;
  conn = await mongoose.connect(MONGO_URI);
  console.log("MongoDB conectado ✅");
  return conn;
}

// ================= SCHEMAS =================
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

const User = mongoose.models.User || mongoose.model("User", userSchema);
const Post = mongoose.models.Post || mongoose.model("Post", postSchema);

// ================= FUNÇÃO SERVERLESS =================
export default async function handler(req, res) {
  await connectDB();

  const url = req.url;
  const method = req.method;
  const parts = url.split("/").filter(Boolean); // remove strings vazias

  // ================= AUTH =================
  if (url.endsWith("/auth/register") && method === "POST") {
    const { email, username, password, grade, region } = req.body;
    if (!email || !username || !password || !grade || !region)
      return res.status(400).json({ error: "Preencha todos os campos" });

    try {
      const user = new User({ email, username, password, grade, region });
      await user.save();
      return res.json({ message: "Conta criada" });
    } catch (err) {
      if (err.code === 11000)
        return res.status(400).json({ error: "Email ou username já cadastrado" });
      return res.status(500).json({ error: "Erro no servidor" });
    }
  }

  if (url.endsWith("/auth/login") && method === "POST") {
    const { email, password } = req.body;
    const user = await User.findOne({ email, password });
    if (!user) return res.status(400).json({ error: "Credenciais inválidas" });

    const token = jwt.sign({ id: user._id, username: user.username }, SECRET);
    return res.json({ token });
  }

  // ================= AUTENTICAÇÃO =================
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  let currentUser = null;
  if (token) {
    try {
      const decoded = jwt.verify(token, SECRET);
      currentUser = await User.findById(decoded.id);
    } catch {}
  }

  // ================= GET POSTS =================
  if (url.endsWith("/posts") && method === "GET") {
    const posts = await Post.find({ hidden: false }).sort({ createdAt: -1 });
    return res.json(posts);
  }

  // ================= CREATE POST =================
  if (url.endsWith("/posts") && method === "POST") {
    if (!currentUser) return res.status(401).json({ error: "Token necessário" });

    const { content, anonymous, hideLikes, mood } = req.body;

    if (!content || content.length > 500)
      return res.status(400).json({ error: "Conteúdo inválido (máx 500 caracteres)" });

    if (/(http|www|\.com|\.net|\.org)/i.test(content))
      return res.status(400).json({ error: "Links não permitidos" });

    const alreadyPostedToday = await Post.findOne({
      userId: currentUser._id,
      createdAt: { $gte: new Date(new Date().setHours(0,0,0,0)) }
    });
    if (alreadyPostedToday)
      return res.status(400).json({ error: "Você já postou hoje" });

    const post = new Post({
      userId: currentUser._id,
      username: currentUser.username,
      content,
      anonymous,
      hideLikes,
      mood
    });

    await post.save();
    return res.json(post);
  }

  // ================= LIKE =================
  if (parts[0] === "posts" && parts[1] && parts[2] === "like" && method === "POST") {
    if (!currentUser) return res.status(401).json({ error: "Token necessário" });

    const postId = parts[1];
    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: "Post não encontrado" });

    const liked = post.likes.some(id => id.equals(currentUser._id));
    if (liked) {
      post.likes = post.likes.filter(id => !id.equals(currentUser._id));
    } else {
      post.likes.push(currentUser._id);
    }

    await post.save();
    return res.json({
      likes: post.likes.length,
      liked: !liked,
      postId: post._id.toString()
    });
  }

  // ================= COMMENT =================
  if (parts[0] === "posts" && parts[1] && parts[2] === "comment" && method === "POST") {
    if (!currentUser) return res.status(401).json({ error: "Token necessário" });

    const postId = parts[1];
    const { content } = req.body;

    if (!content || content.length > 250)
      return res.status(400).json({ error: "Comentário inválido (máx 250 caracteres)" });

    if (/(http|www|\.com|\.net|\.org)/i.test(content))
      return res.status(400).json({ error: "Links não permitidos" });

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: "Post não encontrado" });

    post.comments.push({
      userId: currentUser._id,
      username: currentUser.username,
      content
    });

    await post.save();
    return res.json({ message: "Comentário adicionado" });
  }

  // ================= DELETE POST =================
  if (parts[0] === "posts" && parts[1] && parts.length === 2 && method === "DELETE") {
    if (!currentUser) return res.status(401).json({ error: "Token necessário" });

    const postId = parts[1];
    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: "Post não encontrado" });

    if (!post.userId.equals(currentUser._id))
      return res.status(403).json({ error: "Sem permissão" });

    await Post.deleteOne({ _id: post._id });
    return res.json({ message: "Post apagado" });
  }

  // ================= DELETE COMMENT =================
  if (parts[0] === "posts" && parts[1] && parts[2] === "comment" && parts[3] && method === "DELETE") {
    if (!currentUser) return res.status(401).json({ error: "Token necessário" });

    const postId = parts[1];
    const commentId = parts[3];
    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ error: "Post não encontrado" });

    const comment = post.comments.id(commentId);
    if (!comment) return res.status(404).json({ error: "Comentário não encontrado" });

    if (!comment.userId.equals(currentUser._id))
      return res.status(403).json({ error: "Sem permissão" });

    comment.remove();
    await post.save();
    return res.json({ message: "Comentário apagado" });
  }

  res.status(404).json({ error: "Rota não encontrada" });
}
