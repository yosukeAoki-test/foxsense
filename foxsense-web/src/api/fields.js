import client from './client.js';

export const fieldsApi = {
  list:   ()        => client.get('/fields').then(r => r.data),
  create: (data)    => client.post('/fields', data).then(r => r.data),
  update: (id, data)=> client.put(`/fields/${id}`, data).then(r => r.data),
  remove: (id)      => client.delete(`/fields/${id}`).then(r => r.data),
};
