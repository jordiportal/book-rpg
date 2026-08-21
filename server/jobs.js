// Cola de trabajos asíncronos en memoria.
//
// Flux 2 usa la GPU, así que los trabajos de generación de imágenes se procesan
// con concurrencia limitada (por defecto 1) para no saturar la VRAM. Cuando se
// encola un job, se responde al cliente inmediatamente con su id y el frontend
// hace polling de GET /api/images/jobs/:id hasta que termina.
//
// Estados: pending → running → done | error

const jobs = new Map();
let queue = [];
let active = 0;
const MAX_CONCURRENCY = 1;

function makeId() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Crea un job y lo encola. runFn(job) debe devolver el resultado (se guarda en
// job.result) o lanzar un error (se guarda en job.error).
function createJob(type, data, runFn) {
  const id = makeId();
  const job = {
    id,
    type,
    status: 'pending',
    data,
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null
  };
  jobs.set(id, job);
  queue.push({ id, runFn });
  pump();
  return job;
}

function getJob(id) {
  return jobs.get(id);
}

function pump() {
  while (active < MAX_CONCURRENCY && queue.length > 0) {
    const { id, runFn } = queue.shift();
    const job = jobs.get(id);
    if (!job) continue;
    active++;
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    Promise.resolve()
      .then(() => runFn(job))
      .then((result) => {
        job.status = 'done';
        job.result = result;
      })
      .catch((err) => {
        job.status = 'error';
        job.error = (err && err.message) || String(err);
      })
      .finally(() => {
        active--;
        job.finishedAt = new Date().toISOString();
        pump();
      });
  }
}

export { createJob, getJob };
