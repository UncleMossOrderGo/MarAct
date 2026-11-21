INSERT INTO idea_c_lots (id,farm,name,uses,grade,unit,kg,price,minimum,stock,starts,ends,transit,postcodes,freight,trend) VALUES
('mango-east','สวนรุ่งอรุณ','มะม่วงน้ำดอกไม้','สมูทตี ข้าวเหนียวมะม่วง','สุกพร้อมปั่น','กก.',1,45,10,180,current_date,current_date+90,1,ARRAY['10','11','12'],150,8),
('passion-east','สวนรุ่งอรุณ','เสาวรสสีม่วง','สมูทตี น้ำผลไม้','เกรดแปรรูป','ลัง',6,240,1,30,current_date,current_date+60,1,ARRAY['10','11','12'],150,6),
('mango-west','สวนริมคลอง','มะม่วงน้ำดอกไม้','สมูทตี เบเกอรี','สุกคัดพิเศษ','กก.',1,48,5,80,current_date,current_date+45,2,ARRAY['10','11'],0,7)
ON CONFLICT DO NOTHING;
