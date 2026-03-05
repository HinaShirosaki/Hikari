export function initLabManagement({ state, persist, createId, safeText }) {
  const memberForm = document.getElementById('member-form');
  const memberIdInput = document.getElementById('member-id');
  const memberNameInput = document.getElementById('member-name');
  const memberInstitutionEmailInput = document.getElementById('member-institution-email');
  const memberPositionInput = document.getElementById('member-position');
  const memberEnanaEmailInput = document.getElementById('member-enana-email');
  const memberCancelBtn = document.getElementById('member-cancel-btn');
  const memberCards = document.getElementById('member-cards');

  memberForm.addEventListener('submit', onMemberSubmit);
  memberCancelBtn.addEventListener('click', resetMemberForm);

  function onMemberSubmit(event) {
    event.preventDefault();

    const member = {
      id: memberIdInput.value || createId(),
      name: memberNameInput.value.trim(),
      institutionEmail: memberInstitutionEmailInput.value.trim(),
      position: memberPositionInput.value.trim(),
      enanaEmail: memberEnanaEmailInput.value.trim()
    };

    if (!member.name || !member.institutionEmail || !member.position || !member.enanaEmail) {
      return;
    }

    const index = state.members.findIndex((item) => item.id === member.id);
    if (index >= 0) {
      state.members[index] = member;
    } else {
      state.members.push(member);
    }

    persist();
    resetMemberForm();
    render();
  }

  function resetMemberForm() {
    memberIdInput.value = '';
    memberForm.reset();
  }

  function editMember(memberId) {
    const member = state.members.find((item) => item.id === memberId);
    if (!member) {
      return;
    }

    memberIdInput.value = member.id;
    memberNameInput.value = member.name;
    memberInstitutionEmailInput.value = member.institutionEmail;
    memberPositionInput.value = member.position;
    memberEnanaEmailInput.value = member.enanaEmail;
  }

  function deleteMember(memberId) {
    state.members = state.members.filter((item) => item.id !== memberId);
    persist();
    render();
  }

  function render() {
    if (!state.members.length) {
      memberCards.innerHTML = '<p class="small-note">No members yet.</p>';
      return;
    }

    memberCards.innerHTML = state.members.map((member) => `
      <article class="card">
        <h3>${safeText(member.name)}</h3>
        <p><strong>Institution Email:</strong> ${safeText(member.institutionEmail)}</p>
        <p><strong>Position:</strong> ${safeText(member.position)}</p>
        <p><strong>Enana Email:</strong> ${safeText(member.enanaEmail)}</p>
        <div class="card-actions">
          <button class="ghost-btn" data-member-edit="${member.id}">Edit</button>
          <button class="danger-btn" data-member-delete="${member.id}">Delete</button>
        </div>
      </article>
    `).join('');

    memberCards.querySelectorAll('[data-member-edit]').forEach((button) => {
      button.addEventListener('click', () => editMember(button.dataset.memberEdit));
    });

    memberCards.querySelectorAll('[data-member-delete]').forEach((button) => {
      button.addEventListener('click', () => deleteMember(button.dataset.memberDelete));
    });
  }

  return { render };
}
