-- A product's stock in a bin only exists while positive; the bin itself stays.
DELETE FROM "BinStock" WHERE "quantity" <= 0;
