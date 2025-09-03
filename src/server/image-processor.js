const Queue = require("bull");
const sharp = require("sharp");
const path = require("path");
const mongoose = require("mongoose");
const moment = require("moment");

console.log("Image processor starting...");

const config = require("./config").default || require("./config");

mongoose.Promise = global.Promise;

const connectWithRetry = () => {
  console.log("MongoDB connection with retry");
  
  if (!config || !config.database) {
    console.error("Config or database config missing!");
    setTimeout(connectWithRetry, 5000);
    return;
  }
  
  const mongoUrl = "mongodb://" + config.database.host + ":27017/" + config.database.name;
  mongoose.connect(mongoUrl, { useNewUrlParser: true });
}

mongoose.connection.on("error", err => {
  console.log("MongoDB connection error:", err);
  setTimeout(connectWithRetry, 5000);
});

mongoose.connection.on("connected", () => {
  console.log("MongoDB connected successfully");
});

connectWithRetry();

// Check if Image model already exists, if not define it
let Image;
try {
  Image = mongoose.model("Image");
  console.log("Image model already exists");
} catch (error) {
  console.log("Defining Image model");
  const imageSchema = new mongoose.Schema({
    filename: String,
    authorCid: String,
    galleryId: String,
    thumbnail: String,
    preview: String,
    fullSize: String,
    shotAt: Date,
    author: String,
    exifData: Object
  }, { timestamps: true });
  
  Image = mongoose.model("Image", imageSchema);
}

sharp.cache({ memory: 256 });
sharp.concurrency(2);

const imageQueue = new Queue("image-processing", {
  redis: {
    host: (config && config.redis && config.redis.host) || "redis",
    port: (config && config.redis && config.redis.port) || 6379
  }
});

imageQueue.process(2, function(job, done) {
  console.log("Processing:", job.data.filename);
  
  const data = job.data;
  const thumbnailPath = path.resolve(data.galleryPath, "thumbnails", data.filename + "." + data.extension);
  const previewPath = path.resolve(data.galleryPath, "previews", data.filename + "." + data.extension);
  
  let completed = 0;
  let errors = [];
  
  function checkComplete() {
    completed++;
    job.progress(Math.floor((completed / 3) * 100));
    
    if (completed === 3) {
      if (errors.length > 0) {
        console.error("Failed:", data.filename, errors);
        done(new Error(errors.join(", ")));
      } else {
        console.log("Completed with DB save:", data.filename);
        done(null, {
          filename: data.filename,
          thumbnail: thumbnailPath,
          preview: previewPath
        });
      }
    }
  }
  
  // Process thumbnail
  sharp(data.fullSizeImagePath)
    .rotate()
    .resize(300, 200)
    .crop(sharp.strategy.entropy)
    .toFile(thumbnailPath, function(err) {
      if (err) {
        console.error("Thumbnail error:", err);
        errors.push("thumbnail failed");
      } else {
        console.log("Thumbnail created for", data.filename);
      }
      checkComplete();
    });
  
  // Process preview
  sharp(data.fullSizeImagePath)
    .rotate()
    .resize(null, 800)
    .toFile(previewPath, function(err) {
      if (err) {
        console.error("Preview error:", err);
        errors.push("preview failed");
      } else {
        console.log("Preview created for", data.filename);
      }
      checkComplete();
    });
    
  // Save to database
  const newImage = new Image({
    filename: data.filename,
    authorCid: data.userCid,
    galleryId: data.galleryId,
    thumbnail: thumbnailPath,
    preview: previewPath,
    fullSize: data.fullSizeImagePath,
    shotAt: moment(),
    author: data.userFullname || ""
  });
  
  newImage.save(function(err, saved) {
    if (err) {
      console.error("Database save error:", err);
      errors.push("database save failed");
    } else {
      console.log("Saved to database:", data.filename, "with ID:", saved._id);
    }
    checkComplete();
  });
});

imageQueue.on("completed", function(job) {
  console.log("Job completed:", job.id);
});

imageQueue.on("failed", function(job, err) {
  console.error("Job failed:", job.id, err.message);
});

console.log("Processor ready");

module.exports = imageQueue;