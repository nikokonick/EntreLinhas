const mongoose = require("mongoose");

const MONGO_URI = "mongodb+srv://nikoko:senhaforte2430@entrelinhas.tzpt5a7.mongodb.net/entrelinhas?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log("MongoDB conectado ✅"))
  .catch(err => console.log("Erro MongoDB:", err));

const postSchema = new mongoose.Schema({}, { strict: false });
const Post = mongoose.model("Post", postSchema);

const { ObjectId } = mongoose.Types;

async function fixUserIds() {
  const posts = await Post.find({});
  console.log(`Encontrados ${posts.length} posts.`);

  for (const post of posts) {
    let updated = false;

    // Corrige userId do post
    if (typeof post.userId === "string") {
      post.userId = ObjectId(post.userId);
      updated = true;
    }

    // Corrige userId dos comentários
    if (post.comments && post.comments.length > 0) {
      post.comments.forEach((comment, idx) => {
        if (typeof comment.userId === "string") {
          comment.userId = ObjectId(comment.userId);
          updated = true;
        }
      });
    }

    if (updated) {
      await post.save();
      console.log(`Post ${post._id} atualizado ✅`);
    }
  }

  console.log("Correção concluída!");
  mongoose.connection.close();
}

fixUserIds();
