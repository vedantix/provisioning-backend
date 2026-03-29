import { Router } from 'express';
import { deleteEverythingController } from '../controllers/delete.controller';
import { apiKeyMiddleware } from '../middleware/apiKey.middleware';

const router = Router();

router.post('/delete-everything', apiKeyMiddleware, deleteEverythingController);

export default router;