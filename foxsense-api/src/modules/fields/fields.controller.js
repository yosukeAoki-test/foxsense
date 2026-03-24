import prisma from '../../config/db.js';

export async function list(req, res) {
  const fields = await prisma.field.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json(fields);
}

export async function create(req, res) {
  const { name, cropType, areaHa, bbox, polygon, note } = req.body;
  if (!name || !bbox) return res.status(400).json({ message: 'name と bbox は必須です' });
  if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some(v => typeof v !== 'number'))
    return res.status(400).json({ message: 'bbox は [lon_min, lat_min, lon_max, lat_max] の形式で指定してください' });
  if (areaHa !== undefined && areaHa !== null && Number(areaHa) < 0)
    return res.status(400).json({ message: 'areaHa は 0 以上の値を指定してください' });

  const field = await prisma.field.create({
    data: {
      userId: req.user.id,
      name,
      cropType: cropType || null,
      areaHa: areaHa ? Number(areaHa) : null,
      bbox: JSON.stringify(bbox),
      polygon: polygon ? JSON.stringify(polygon) : null,
      note: note || null,
    },
  });
  res.status(201).json(field);
}

export async function update(req, res) {
  const field = await prisma.field.findUnique({ where: { id: req.params.id } });
  if (!field) return res.status(404).json({ message: 'Not found' });
  if (field.userId !== req.user.id) return res.status(403).json({ message: 'Forbidden' });

  const { name, cropType, areaHa, note } = req.body;
  const updated = await prisma.field.update({
    where: { id: req.params.id },
    data: { name, cropType, areaHa: areaHa ? Number(areaHa) : field.areaHa, note },
  });
  res.json(updated);
}

export async function remove(req, res) {
  const field = await prisma.field.findUnique({ where: { id: req.params.id } });
  if (!field) return res.status(404).json({ message: 'Not found' });
  if (field.userId !== req.user.id) return res.status(403).json({ message: 'Forbidden' });

  await prisma.field.delete({ where: { id: req.params.id } });
  res.json({ success: true });
}
