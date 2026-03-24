import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import * as c from './fields.controller.js';

const router = Router();
router.use(authenticate);

router.get('/',       c.list);
router.post('/',      c.create);
router.put('/:id',    c.update);
router.delete('/:id', c.remove);

export default router;
