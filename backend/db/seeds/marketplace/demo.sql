INSERT INTO idea_c_lots (id,farm,name,uses,grade,unit,kg,price,minimum,stock,starts,ends,transit,postcodes,freight,trend) VALUES
('mango-east','สวนรุ่งอรุณ','มะม่วงน้ำดอกไม้','สมูทตี ข้าวเหนียวมะม่วง','สุกพร้อมปั่น','กก.',1,45,10,180,current_date,current_date+90,1,ARRAY['10','11','12'],150,8),
('passion-east','สวนรุ่งอรุณ','เสาวรสสีม่วง','สมูทตี น้ำผลไม้','เกรดแปรรูป','ลัง',6,240,1,30,current_date,current_date+60,1,ARRAY['10','11','12'],150,6),
('mango-west','สวนริมคลอง','มะม่วงน้ำดอกไม้','สมูทตี เบเกอรี','สุกคัดพิเศษ','กก.',1,48,5,80,current_date,current_date+45,2,ARRAY['10','11'],0,7)
ON CONFLICT DO NOTHING;

-- Sample inventory: each fruit has four offers with different purchasing and delivery terms.
WITH fruit(code, name, uses, price_kg, interest) AS (VALUES
    ('mango', 'มะม่วงน้ำดอกไม้', 'สมูทตี ข้าวเหนียวมะม่วง', 45, 8),
    ('passion', 'เสาวรสสีม่วง', 'น้ำผลไม้ ซอส', 52, 6),
    ('banana', 'กล้วยหอมทอง', 'เบเกอรี สมูทตี', 32, 5),
    ('pineapple', 'สับปะรดปัตตาเวีย', 'น้ำผลไม้ ผลไม้ตัดแต่ง', 22, 7),
    ('orange', 'ส้มสายน้ำผึ้ง', 'น้ำส้มคั้น ผลไม้สด', 48, 6),
    ('guava', 'ฝรั่งกิมจู', 'ผลไม้ตัดแต่ง น้ำผลไม้', 35, 4),
    ('dragon', 'แก้วมังกรเนื้อแดง', 'สมูทตี สลัด', 44, 5),
    ('papaya', 'มะละกอฮอลแลนด์', 'ผลไม้ตัดแต่ง สลัด', 28, 4),
    ('watermelon', 'แตงโมกินรี', 'น้ำผลไม้ ผลไม้ตัดแต่ง', 18, 7),
    ('pomelo', 'ส้มโอขาวน้ำผึ้ง', 'ผลไม้สด ยำ', 55, 5)
), offer(code, farm, grade, unit, kg, adjustment, minimum, stock, delay, transit, zones, freight) AS (VALUES
    ('retail', 'สวนสายลม (เดโม)', 'คัดพิเศษ', 'กก.', 1, 8, 3, 18, 0, 1, ARRAY['10','11','12'], 60),
    ('crate', 'สวนบ้านดอน (เดโม)', 'คละขนาด', 'ลัง', 10, -5, 3, 40, 2, 2, ARRAY['10','50','51'], 180),
    ('basket', 'สวนลานทอง (เดโม)', 'เกรดร้านอาหาร', 'ตะกร้า', 5, 0, 2, 15, 0, 2, ARRAY['10','20','21'], 90),
    ('bulk', 'สวนคลองใหม่ (เดโม)', 'เกรดแปรรูป', 'ลัง', 15, -8, 4, 60, 5, 3, ARRAY['12','70','73'], 220)
)
INSERT INTO idea_c_lots (id,farm,name,uses,grade,unit,kg,price,minimum,stock,starts,ends,transit,postcodes,freight,trend)
SELECT 'demo-' || fruit.code || '-' || offer.code, farm, name, uses, grade, unit, kg,
       (price_kg + adjustment) * kg, minimum, stock, current_date + delay,
       current_date + 90, transit, zones, freight, interest
FROM fruit CROSS JOIN offer
ON CONFLICT (id) DO NOTHING;
