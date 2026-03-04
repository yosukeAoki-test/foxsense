import prisma from '../../config/db.js';

let lastBridgePing = null;
export const recordHeartbeat = () => { lastBridgePing = Date.now(); };
export const getBridgeAlive = () => !!(lastBridgePing && Date.now() - lastBridgePing < 15000);

export const createJob = async ({ text, tapeMm, userId }) => {
  return prisma.printJob.create({
    data: { text, tapeMm: tapeMm ?? 12, createdBy: userId ?? null },
  });
};

export const getJobs = async () => {
  return prisma.printJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
};

export const getPendingJob = async () => {
  return prisma.printJob.findFirst({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
  });
};

export const claimJob = async (id) => {
  return prisma.printJob.update({
    where: { id },
    data: { status: 'printing' },
  });
};

export const getJobById = async (id) => {
  return prisma.printJob.findUnique({ where: { id } });
};

export const updateJobStatus = async (id, status, error) => {
  return prisma.printJob.update({
    where: { id },
    data: { status, error: error ?? null },
  });
};
