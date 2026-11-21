ALTER TABLE idea_c_lots ADD COLUMN is_sample boolean NOT NULL DEFAULT false;

UPDATE idea_c_lots SET is_sample = true
WHERE (id, farm, name) IN (
    ('mango-east', 'สวนรุ่งอรุณ', 'มะม่วงน้ำดอกไม้'),
    ('passion-east', 'สวนรุ่งอรุณ', 'เสาวรสสีม่วง'),
    ('mango-west', 'สวนริมคลอง', 'มะม่วงน้ำดอกไม้')
);
