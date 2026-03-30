import prisma from '../../config/db.js';
import { AppError } from '../../middleware/errorHandler.js';

export const getLocations = async (userId) => {
  return prisma.location.findMany({
    where: { userId },
    orderBy: { name: 'asc' },
  });
};

export const createLocation = async (userId, data) => {
  return prisma.location.create({
    data: {
      userId,
      name: data.name,
      latitude: data.latitude,
      longitude: data.longitude,
      address: data.address ?? null,
    },
  });
};

export const updateLocation = async (id, userId, data) => {
  const loc = await prisma.location.findFirst({ where: { id, userId } });
  if (!loc) throw new AppError('Location not found', 404);

  return prisma.location.update({
    where: { id },
    data: {
      name: data.name,
      latitude: data.latitude,
      longitude: data.longitude,
      address: data.address ?? null,
    },
  });
};

export const deleteLocation = async (id, userId) => {
  const loc = await prisma.location.findFirst({ where: { id, userId } });
  if (!loc) throw new AppError('Location not found', 404);

  // この地点を参照している親機のlocationIdをクリア
  await prisma.parentDevice.updateMany({
    where: { locationId: id },
    data: { locationId: null },
  });

  await prisma.location.delete({ where: { id } });
};
