-- Add stock column to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER DEFAULT 0;

-- Update existing products to have stock from inventory_stock_items if available
UPDATE products
SET stock = COALESCE((
  SELECT SUM(isi.quantity)
  FROM inventory_stock_items isi
  WHERE isi.product_id = products.id
), 0)
WHERE stock = 0 OR stock IS NULL;