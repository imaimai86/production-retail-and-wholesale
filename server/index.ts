import path from 'path';
// Load environment variables from .env using dotenv
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import express, { Request, Response, NextFunction, Application } from 'express';
import * as Products from './models/products';
import * as Batches from './models/batches';
import * as Inventory from './models/inventory';
import * as Sales from './models/sales';
import * as Users from './models/users';
import * as Categories from './models/categories';
import Auth from './middleware/auth';

// Define a custom request type that includes userId
interface AuthenticatedRequest extends Request {
  userId?: number;
}

const app: Application = express();
const port: string | number = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.use(Auth.verify as express.RequestHandler); // Cast if necessary

app.post('/users', Auth.requireAdmin as express.RequestHandler, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await Users.create(req.body);
    res.status(201).json(user);
    return;
  } catch (err) {
    next(err);
  }
});

app.get('/users', Auth.requireAdmin as express.RequestHandler, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const page: number = parseInt(req.query.page as string) || 1;
  const limit: number = parseInt(req.query.limit as string) || 10;
  const offset: number = (page - 1) * limit;
  try {
    const users = await Users.getAll({ limit, offset });
    res.json(users);
    return;
  } catch (err) {
    next(err);
  }
});

app.get('/categories', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const page: number = parseInt(req.query.page as string) || 1;
  const limit: number = parseInt(req.query.limit as string) || 10;
  const offset: number = (page - 1) * limit;
  try {
    const cats = await Categories.getAll({ limit, offset });
    res.json(cats);
    return;
  } catch (err) {
    next(err);
  }
});

app.post('/categories', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const cat = await Categories.create(req.body);
    res.status(201).json(cat);
    return;
  } catch (err) {
    next(err);
  }
});

app.get('/products', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const page: number = parseInt(req.query.page as string) || 1;
  const limit: number = parseInt(req.query.limit as string) || 10;
  const offset: number = (page - 1) * limit;
  try {
    const products = await Products.getAll({ limit, offset });
    res.json(products);
    return;
  } catch (err) {
    next(err);
  }
});

app.post('/products', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const product = await Products.create(req.body);
    res.status(201).json(product);
    return;
  } catch (err) {
    next(err);
  }
});

app.get('/products/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const product = await Products.getById(req.params.id);
    if (!product) {
      res.status(404).end();
      return;
    }
    res.json(product);
    return;
  } catch (err) {
    next(err);
  }
});

app.put('/products/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const product = await Products.update(req.params.id, req.body);
    if (!product) {
      res.status(404).end();
      return;
    }
    res.json(product);
    return;
  } catch (err) {
    next(err);
  }
});

app.delete('/products/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await Products.remove(req.params.id);
    res.status(204).end();
    return;
  } catch (err) {
    next(err);
  }
});

app.get('/batches', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const page: number = parseInt(req.query.page as string) || 1;
  const limit: number = parseInt(req.query.limit as string) || 10;
  const offset: number = (page - 1) * limit;
  try {
    const batches = await Batches.getAll({ limit, offset });
    res.json(batches);
    return;
  } catch (err) {
    next(err);
  }
});

app.post('/batches', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const batch = await Batches.create(req.body);
    res.status(201).json(batch);
    return;
  } catch (err) {
    next(err);
  }
});

app.get('/inventory', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const page: number = parseInt(req.query.page as string) || 1;
  const limit: number = parseInt(req.query.limit as string) || 10;
  const offset: number = (page - 1) * limit;
  try {
    const items = await Inventory.getAll({ limit, offset });
    res.json(items);
    return;
  } catch (err) {
    next(err);
  }
});

app.post('/inventory/transfer', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { product_id, from, to, quantity } = req.body;
  try {
    const inventory = await Inventory.transfer(product_id, from, to, quantity);
    res.json(inventory);
    return;
  } catch (err) {
    next(err);
  }
});

app.get('/sales', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const page: number = parseInt(req.query.page as string) || 1;
  const limit: number = parseInt(req.query.limit as string) || 10;
  const offset: number = (page - 1) * limit;
  try {
    const sales = await Sales.getAll({ limit, offset });
    res.json(sales);
    return;
  } catch (err) {
    next(err);
  }
});

app.post('/sales', async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Assuming req.userId is populated by Auth.verify middleware
    const sale = await Sales.create({ ...req.body, user_id: req.userId });
    res.status(201).json(sale);
    return;
  } catch (err) {
    next(err);
  }
});

app.patch('/sales/:id/status', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sale = await Sales.updateStatus(req.params.id, req.body.status);
    if (!sale) {
      res.status(404).end();
      return;
    }
    res.json(sale);
    return;
  } catch (err) {
    next(err);
  }
});

app.delete('/sales/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sale = await Sales.remove(req.params.id);
    if (!sale) {
      res.status(404).end();
      return;
    }
    res.status(200).json(sale);
    return;
  } catch (err) {
    next(err);
  }
});

app.get('/sales/:id/invoice', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sale: Sales.Sale | undefined = await Sales.getById(req.params.id);
    // naive invoice generation using sale record
    if (!sale) {
      res.status(404).end();
      return;
    }
    const lineTotal: number = sale.price * sale.quantity - (sale.discount || 0);
    const gstAmount: number = lineTotal * (sale.gst / 100);
    res.json({
      items: [{ product_id: sale.product_id, quantity: sale.quantity, price: sale.price, gst: sale.gst }],
      total: lineTotal + gstAmount,
      gst: gstAmount
    });
    return;
  } catch (err) {
    next(err);
  }
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

export default app;
