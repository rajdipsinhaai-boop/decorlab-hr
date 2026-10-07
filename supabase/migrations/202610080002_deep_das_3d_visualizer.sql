update public.employees set role = '3D Visualizer', updated_at = now() where id = 'DLB-DSG-04';
update public.monthly_director_rating_details set role = '3D Visualizer' where employee_id = 'DLB-DSG-04';
-- Not applicable to a 3D Visualizer: drop the blank (unrated) rows for them. Past ratings are kept as history.
delete from public.monthly_director_rating_details
where employee_id = 'DLB-DSG-04' and rating_1_to_5 is null
  and kra_parameter in ('Technical / Drawing Accuracy', 'Site Problem-Solving Skills');
