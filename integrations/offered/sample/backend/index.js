// A made-up offered backend. Nothing in this repo imports or runs it.
export default {
  tools: {
    async notes_list(_input, kit) {
      const response = await kit.http.get("https://api.example.com/notes");
      return response.json();
    },
  },
};
