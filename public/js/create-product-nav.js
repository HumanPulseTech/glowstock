document.querySelectorAll('[data-create-product]').forEach((button) => {
    button.addEventListener('click', () => window.location.assign('/dashboard/add_produit/'));
});
