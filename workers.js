const cluster = require("cluster");
const numCPUs = require("os").cpus().length;

if (cluster.isMaster) {
  console.log("Master process starting with PID:", process.pid);
  
  const numWorkers = Math.max(1, Math.floor(numCPUs / 2));
  
  console.log("Starting " + numWorkers + " workers...");
  
  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }
  
  cluster.on("exit", function(worker, code, signal) {
    console.log("Worker " + worker.process.pid + " died");
    cluster.fork();
  });
  
} else {
  console.log("Worker started with PID:", process.pid);

  require("./dist/image-processor");
}